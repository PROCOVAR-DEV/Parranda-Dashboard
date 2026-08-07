"""
/api/stock — live Parranda stock queried directly from AxisPos MySQL.
Stock is never stored in PostgreSQL; each request queries the selected
territory databases in parallel threads.
"""
from __future__ import annotations

import concurrent.futures
import logging
import threading
import time
from datetime import date

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config
from etl.extract import extract_stock_territory
from routes.ventas import parse_date
from auth import territorios_permitidos

logger = logging.getLogger(__name__)

bp = Blueprint("stock", __name__)

TERRITORY_TIMEOUT = 15  # seconds per territory before treating as failed

# El stock NO se guarda en Postgres: cada peticion consulta en vivo las 9 bases
# MySQL de AxisPos, una conexion por territorio. Con cuatro personas mirando el
# panel a la vez eso son 36 conexiones simultaneas contra AxisPos, y cada una
# tarda ~1,5 s. Los parranderos comparten UNA sola cuenta, asi que cuatro
# personas mirando lo mismo es el caso normal, no el raro.
#
# Con esta cache corta, cuatro personas mirando el mismo dia son UNA consulta en
# vez de cuatro, y volver a la pantalla dentro de la ventana no consulta nada.
# El stock de un dia no cambia de un segundo a otro: 45 segundos de retraso como
# mucho no cambia ninguna decision, y a cambio AxisPos deja de recibir avalanchas.
CACHE_SEGUNDOS = 45

_cache: dict[tuple, tuple[float, tuple[list[dict], list[str]]]] = {}
_cache_lock = threading.Lock()
# Un cerrojo POR CLAVE: si dos personas piden lo mismo a la vez, la segunda
# espera a la primera en vez de lanzar otras 9 conexiones. Sin esto, la cache no
# sirve de nada justo cuando mas falta hace — cuando todos entran a la vez.
_en_curso: dict[tuple, threading.Lock] = {}


def _fetch_stock_cacheado(fecha: date, territorios_filter: set[str] | None):
    clave = (fecha.isoformat(), tuple(sorted(territorios_filter or ())))
    ahora = time.time()

    with _cache_lock:
        guardado = _cache.get(clave)
        if guardado and ahora - guardado[0] < CACHE_SEGUNDOS:
            return guardado[1]
        cerrojo = _en_curso.setdefault(clave, threading.Lock())

    with cerrojo:
        # Al entrar puede que otro ya la haya traido mientras esperabamos.
        with _cache_lock:
            guardado = _cache.get(clave)
            if guardado and time.time() - guardado[0] < CACHE_SEGUNDOS:
                return guardado[1]

        resultado = fetch_stock(fecha, territorios_filter)

        with _cache_lock:
            # Solo se guarda si TODOS los territorios respondieron. Guardar un
            # resultado incompleto lo dejaria fijo 45 segundos y la pantalla
            # ensenaria un stock a medias sin forma de refrescarlo.
            if not resultado[1]:
                _cache[clave] = (time.time(), resultado)
            # La cache se limpia sola: son pocas claves (un dia x un filtro) y
            # las viejas se caen por tiempo, pero sin esto crecerian sin fin.
            for k, (t, _) in list(_cache.items()):
                if time.time() - t > CACHE_SEGUNDOS * 10:
                    _cache.pop(k, None)
                    _en_curso.pop(k, None)

        return resultado


def fetch_stock(fecha: date, territorios_filter: set[str] | None = None) -> tuple[list[dict], list[str]]:
    """Query live stock for the given territories. Returns (rows, failed_territories)."""
    targets = [
        entry for entry in config.TERRITORY_DB_MAP
        if not territorios_filter or entry["nombre"] in territorios_filter
    ]

    all_rows: list[dict] = []
    failed: list[str] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(config.TERRITORY_DB_MAP)) as pool:
        futures = {
            pool.submit(
                extract_stock_territory, entry["nombre"], entry["db"], fecha, entry.get("fecha_min")
            ): entry["nombre"]
            for entry in targets
        }
        for future in concurrent.futures.as_completed(futures):
            nombre = futures[future]
            try:
                all_rows.extend(future.result(timeout=TERRITORY_TIMEOUT))
            except concurrent.futures.TimeoutError:
                logger.warning("Stock query timed out for %s (>%ds)", nombre, TERRITORY_TIMEOUT)
                failed.append(nombre)
            except Exception as exc:
                logger.error("Stock query failed for %s: %s", nombre, exc)
                failed.append(nombre)

    orden_map = {entry["nombre"]: entry["orden"] for entry in config.TERRITORY_DB_MAP}
    sku_orden = {s["codigo"]: s["orden"] for s in config.PARRANDA_SKUS}
    all_rows.sort(key=lambda r: (orden_map.get(r["territorio"], 99), sku_orden.get(r["sku_codigo"], 99)))
    return all_rows, sorted(failed)


@bp.route("/stock")
@jwt_required()
def get_stock():
    """
    Query params:
      fecha       YYYY-MM-DD (default: today)
      territorio  repeatable (omit = all 9)
    """
    fecha = parse_date(request.args.get("fecha"), date.today())
    # Igual que las demas: el permiso lo decide `territorios_permitidos`.
    _permitidos = territorios_permitidos(request.args.getlist("territorio"))
    territorios_filter = set(_permitidos) if _permitidos else set()

    rows, failed = _fetch_stock_cacheado(fecha, territorios_filter)

    return jsonify({
        "meta": {"fecha": fecha.isoformat(), "territorios_fallidos": failed},
        "rows": rows,
    })
