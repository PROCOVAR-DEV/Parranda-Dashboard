"""Reportes ya calculados, guardados en Postgres.

Cada pestaña del panel rehacía su consulta entera en cada carga. Con varias
personas mirando lo mismo —y los parranderos comparten una sola cuenta, así que
mirar lo mismo a la vez es lo normal— la base repetía el mismo trabajo una vez
por persona, y otra vez cada vez que alguien volvía a la pestaña.

Nada de ese resultado cambia entre peticiones salvo que corra el ETL o se toquen
las metas. Así que se guarda el reporte ya calculado y se rehace SOLO cuando esos
datos cambian de verdad.

**Por qué en Postgres y no en memoria:** sobrevive a los reinicios y a los
despliegues (que aquí son frecuentes), lo comparten todos los procesos si algún
día hay más de un worker, y no ocupa memoria del servidor.

**La invalidación sale de los propios datos**, no de un contador que haya que
acordarse de tocar: si la huella cambia, lo guardado deja de valer solo. Un
contador en memoria se olvidaría en el siguiente despliegue y serviría datos
viejos sin que nadie se enterara — que es la peor forma de fallar, porque nada
parece roto.

**El stock NO pasa por aquí a propósito.** Es en vivo por regla de negocio (no se
guarda nunca en Postgres); tiene su propia caché corta en memoria, que no lo
persiste.
"""
from __future__ import annotations

import json
import logging
import os

from sqlalchemy import text

logger = logging.getLogger(__name__)

# Cuántos días se conserva un reporte antes de tirarlo. Si alguien lo vuelve a
# pedir se rehace solo.
DIAS_RETENCION = int(os.environ.get("PARRANDA_RETENCION_DIAS", "30"))


def version_datos() -> str | None:
    """Huella de los datos. Cambia cuando cambia algo que afecta a los reportes.

    Entran tres cosas:
      - el último ETL (cuándo terminó, cuántas filas y cómo acabó), que es lo que
        mueve ventas, clientes, pedidos y portafolio;
      - la última vez que se tocó una meta, porque Real-vs-Meta depende de ellas
        y el ETL no las toca;
      - la config de días laborales del mes, por lo mismo.

    Devuelve None si no se puede calcular: en ese caso NO se cachea nada. Es
    preferible recalcular de más que arriesgarse a servir algo viejo.
    """
    from app import SessionLocal

    try:
        s = SessionLocal()
        try:
            fila = s.execute(text(
                "select coalesce(max(id), 0),"
                "       coalesce(max(extract(epoch from finished_at))::bigint, 0),"
                "       coalesce(sum(rows_upserted), 0)"
                "  from refresh_log"
            )).first()
            # En metas y en la config del mes entran tambien los VALORES, no solo
            # cuantas filas hay. Editar una meta no cambia el numero de filas ni
            # el id mas alto: si la huella mirara solo eso, cambiar una meta no
            # invalidaria nada y el panel seguiria enseniando la cifra vieja sin
            # que nada pareciera roto.
            metas = s.execute(text(
                "select count(*), coalesce(max(extract(epoch from updated_at))::bigint, 0),"
                "       coalesce(sum(hl), 0) from metas"
            )).first()
            cfg = s.execute(text(
                "select count(*), coalesce(sum(dias_totales), 0) from meta_month_config"
            )).first()
            return "|".join(str(x) for x in (*fila, *metas, *cfg))
        finally:
            s.close()
    except Exception:
        logger.exception("No se pudo calcular la huella de los datos")
        return None


def obtener_o_calcular(clave: tuple, fn):
    """Devuelve el reporte guardado si los datos no han cambiado; si no, lo
    calcula, lo guarda y lo devuelve."""
    from app import SessionLocal

    version = version_datos()
    if version is None:
        return fn()

    cache_key = "|".join(str(k) for k in clave)

    try:
        s = SessionLocal()
        try:
            # Se marca la lectura en el mismo golpe, para que la limpieza sepa
            # qué reportes se usan de verdad y cuáles llevan semanas sin abrirse.
            fila = s.execute(text(
                "update report_cache set last_read_at = now()"
                " where cache_key = :k and version = :v"
                " returning payload"
            ), {"k": cache_key, "v": version}).first()
            s.commit()
            if fila is not None:
                return fila[0]
        finally:
            s.close()
    except Exception:
        logger.exception("Fallo leyendo el reporte guardado %s; se recalcula", cache_key)

    valor = fn()
    if valor is None:
        return None

    try:
        s = SessionLocal()
        try:
            # Una fila por clave: al recalcular se pisa la anterior, así la tabla
            # no crece guardando versiones viejas que ya no vale nadie.
            s.execute(text(
                "insert into report_cache"
                "       (cache_key, version, payload, computed_at, last_read_at)"
                " values (:k, :v, cast(:p as jsonb), now(), now())"
                " on conflict (cache_key) do update"
                "    set version = excluded.version,"
                "        payload = excluded.payload,"
                "        computed_at = excluded.computed_at,"
                "        last_read_at = excluded.last_read_at"
            ), {"k": cache_key, "v": version, "p": json.dumps(valor, default=str)})
            s.commit()
        finally:
            s.close()
    except Exception:
        # Que falle el guardado no puede tumbar la respuesta: el usuario ya tiene
        # su reporte calculado. Se anota y se sigue.
        logger.exception("No se pudo guardar el reporte %s", cache_key)

    return valor


def cachear_reporte(nombre: str):
    """Envuelve una ruta para que su resultado se guarde y se reutilice.

    Se hace con un decorador y NO tocando el cuerpo de cada ruta: asi el calculo
    de cada reporte se queda exactamente como estaba, con sus reglas de negocio
    intactas, y esto solo decide si hace falta ejecutarlo o no.

    La clave lleva TODOS los parametros de la peticion. Si faltara uno, dos
    consultas distintas compartirian resultado y alguien veria los numeros de
    otro periodo o de otro territorio — un fallo silencioso, de los que nadie
    nota hasta que cuadra mal una cifra.

    Va DEBAJO de @jwt_required: primero se comprueba quien pide, y solo despues
    se mira si hay algo guardado.
    """
    from functools import wraps

    from flask import jsonify, request

    def decorador(fn):
        @wraps(fn)
        def envuelto(*args, **kwargs):
            clave = (nombre, *sorted(request.args.items(multi=True)))
            directo = None

            def calcular():
                nonlocal directo
                resp = fn(*args, **kwargs)
                # Un error (400, 403...) NO se guarda: quedaria fijo y todo el
                # mundo veria el mismo fallo hasta que cambiaran los datos.
                if isinstance(resp, tuple) or getattr(resp, "status_code", 200) != 200:
                    directo = resp
                    return None
                return resp.get_json()

            datos = obtener_o_calcular(clave, calcular)
            if directo is not None:
                return directo
            return jsonify(datos)

        return envuelto

    return decorador


def limpiar(dias: int | None = None) -> int:
    """Borra los reportes que nadie ha abierto en `dias`."""
    from app import SessionLocal

    dias = DIAS_RETENCION if dias is None else dias
    try:
        s = SessionLocal()
        try:
            n = s.execute(text(
                "delete from report_cache where last_read_at < now() - make_interval(days => :d)"
            ), {"d": dias}).rowcount
            s.commit()
            return n or 0
        finally:
            s.close()
    except Exception:
        logger.exception("No se pudo limpiar la caché de reportes")
        return 0


def estado() -> dict:
    """Cuántos reportes hay guardados y cuánto ocupan. Para la pantalla de Admin."""
    from app import SessionLocal

    try:
        s = SessionLocal()
        try:
            fila = s.execute(text(
                "select count(*), coalesce(pg_size_pretty(sum(pg_column_size(payload))), '0 B'),"
                "       max(computed_at)"
                "  from report_cache"
            )).first()
            return {"reportes": fila[0], "tamano": fila[1], "ultimo_calculo": str(fila[2]) if fila[2] else None}
        finally:
            s.close()
    except Exception:
        logger.exception("No se pudo leer el estado de la caché")
        return {"reportes": 0, "tamano": "0 B", "ultimo_calculo": None}
