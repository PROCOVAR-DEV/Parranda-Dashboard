"""
/api/pedidos — pedidos levantados y su conversión a facturas AxisPos.

A pedido is `convertido` when its folio appears in the observación of at least one
AxisPos factura (facturas_observacion.folio_extraido). Matching ignores territory
on purpose: it makes the Moa / Palma Soriano cutover work without special-casing
(their pre-2026-07-15 facturas live in the santiago / holguinmoa databases) and it
surfaces pedidos billed from a different sucursal as its own signal.

IMPORTANT — reading the conversion rate:
the paste of "P-<folio>" into the observación is manual and adoption varies wildly
per territory (measured 2026-07: Camagüey ~99%, Havana ~32%, Palma Soriano 0%).
An untagged factura is indistinguishable from a pedido that never converted, so
`cobertura_codigo` is returned alongside every conversion figure. A low conversion
rate in a territory with low cobertura is a data-entry problem, not a sales
problem, and the UI must show them together.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func

from cache_reportes import cachear_reporte
from routes.ventas import parse_date

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config

bp = Blueprint("pedidos", __name__)

ESTADO_EN_PROCESO = "en_proceso"
ESTADO_COMPLETADA = "completada"
ESTADO_EXPIRADA = "expirada"

# Why an unconverted pedido never became a factura. Ordered by how actionable it
# is; the UI renders them in this order.
MOTIVO_EXPIRADA = "expirada"                       # murió por los 72h
MOTIVO_COMPLETADA_SIN_FACTURA = "completada_sin_factura"  # procesada pero sin factura
MOTIVO_EN_PROCESO_VENCIDO = "en_proceso_vencido"   # sigue abierta y ya pasó la fecha comprometida
MOTIVO_EN_PROCESO_VIGENTE = "en_proceso_vigente"   # todavía dentro de plazo — no es una falla

MOTIVOS = (
    MOTIVO_EXPIRADA,
    MOTIVO_COMPLETADA_SIN_FACTURA,
    MOTIVO_EN_PROCESO_VENCIDO,
    MOTIVO_EN_PROCESO_VIGENTE,
)


def _motivo(estado: str, fecha_comprometida: date | None, hoy: date) -> str:
    if estado == ESTADO_EXPIRADA:
        return MOTIVO_EXPIRADA
    if estado == ESTADO_COMPLETADA:
        return MOTIVO_COMPLETADA_SIN_FACTURA
    if fecha_comprometida is not None and fecha_comprometida < hoy:
        return MOTIVO_EN_PROCESO_VENCIDO
    return MOTIVO_EN_PROCESO_VIGENTE


def _hl(sku_codigo: str, blisters: float) -> float:
    return blisters * config.hl_factor(sku_codigo)


def _folio_match_subquery(db):
    """folio → first factura date, blisters facturados, number of facturas."""
    from models import FacturaObservacion

    return (
        db.query(
            FacturaObservacion.folio_extraido.label("folio"),
            func.min(FacturaObservacion.fecha).label("primera_factura"),
            func.sum(FacturaObservacion.cantidad).label("cantidad_facturada"),
            func.count().label("facturas"),
        )
        .filter(FacturaObservacion.folio_extraido.isnot(None))
        .group_by(FacturaObservacion.folio_extraido)
        .subquery()
    )


def _load_pedidos(db, fecha_inicio, fecha_fin, territorios_filter, skus_filter):
    """
    Pedidos in range with their conversion state and per-SKU quantities.

    Returns (pedidos, items_por_pedido). Aggregation is done in Python: the volume
    is modest (~11k pedidos/month) and it keeps eight breakdowns from becoming
    eight near-identical SQL queries.
    """
    from models import Pedido, PedidoItem, SKU, Territory

    match = _folio_match_subquery(db)

    q = (
        db.query(
            Pedido.id,
            Pedido.folio,
            Pedido.fecha,
            Pedido.fecha_comprometida,
            Pedido.estado,
            Pedido.vendedor,
            Pedido.cliente_nombre,
            Pedido.requiere_domicilio,
            Pedido.archivado,
            Territory.nombre.label("territorio"),
            Territory.orden.label("orden"),
            match.c.primera_factura,
            match.c.cantidad_facturada,
        )
        .join(Territory, Pedido.territory_id == Territory.id)
        .outerjoin(match, match.c.folio == Pedido.folio)
        .filter(Pedido.fecha >= fecha_inicio, Pedido.fecha <= fecha_fin)
    )
    if territorios_filter:
        q = q.filter(Territory.nombre.in_(territorios_filter))

    pedidos = q.all()
    if not pedidos:
        return [], {}

    pedido_ids = [p.id for p in pedidos]
    items_q = (
        db.query(PedidoItem.pedido_id, SKU.codigo, PedidoItem.cantidad, PedidoItem.unidades)
        .join(SKU, PedidoItem.sku_id == SKU.id)
        .filter(PedidoItem.pedido_id.in_(pedido_ids))
    )
    if skus_filter:
        items_q = items_q.filter(SKU.codigo.in_(skus_filter))

    items: dict[int, list] = defaultdict(list)
    for row in items_q.all():
        items[row.pedido_id].append(row)

    # With a SKU filter active, a pedido that carries none of the selected SKUs
    # drops out entirely — otherwise the pedido counts would not agree with the
    # quantities shown next to them.
    if skus_filter:
        pedidos = [p for p in pedidos if items.get(p.id)]

    return pedidos, items


def _factura_stats(db, fecha_inicio, fecha_fin, territorios_filter):
    """Per-territory factura counts + how many carry a pedido code (cobertura)."""
    from models import FacturaObservacion, Territory

    q = (
        db.query(
            Territory.nombre.label("territorio"),
            Territory.orden.label("orden"),
            func.count().label("facturas"),
            func.count(FacturaObservacion.folio_extraido).label("con_codigo"),
        )
        .join(Territory, FacturaObservacion.territory_id == Territory.id)
        .filter(FacturaObservacion.fecha >= fecha_inicio, FacturaObservacion.fecha <= fecha_fin)
    )
    if territorios_filter:
        q = q.filter(Territory.nombre.in_(territorios_filter))

    stats = {}
    for r in q.group_by(Territory.nombre, Territory.orden).all():
        facturas, con_codigo = int(r.facturas), int(r.con_codigo)
        stats[r.territorio] = {
            "orden": r.orden,
            "facturas": facturas,
            "facturas_con_codigo": con_codigo,
            "facturas_sin_codigo": facturas - con_codigo,
            "cobertura_codigo": round(100.0 * con_codigo / facturas, 1) if facturas else 0.0,
        }
    return stats


def _rate(part: float, whole: float) -> float:
    """Percentage, safe on a zero denominator. Works for counts and for HL alike."""
    return round(100.0 * part / whole, 1) if whole else 0.0


@bp.route("/pedidos")
@jwt_required()
@cachear_reporte("pedidos")
def get_pedidos():
    """
    Query params:
      fecha_inicio  YYYY-MM-DD (default: first of current month)
      fecha_fin     YYYY-MM-DD (default: today)
      territorio    repeatable (omit = all)
      sku           repeatable (omit = all 5)
    """
    from app import get_db

    today = date.today()
    fecha_inicio = parse_date(request.args.get("fecha_inicio"), date(today.year, today.month, 1))
    fecha_fin = parse_date(request.args.get("fecha_fin"), today)
    territorios_filter = request.args.getlist("territorio")
    skus_filter = request.args.getlist("sku")

    db = get_db()
    try:
        pedidos, items = _load_pedidos(db, fecha_inicio, fecha_fin, territorios_filter, skus_filter)
        facturas = _factura_stats(db, fecha_inicio, fecha_fin, territorios_filter)

        # ── Accumulators ────────────────────────────────────────────────────
        por_dia: dict[tuple, dict] = {}
        por_territorio: dict[str, dict] = {}
        por_vendedor: dict[tuple, dict] = {}
        por_sku: dict[str, dict] = {}
        motivos: dict[str, int] = defaultdict(int)
        estados: dict[str, int] = defaultdict(int)
        leadtime: dict[int, int] = defaultdict(int)

        total = convertidos = 0
        blisters_pedidos = blisters_facturados = 0.0
        hl_pedidos = hl_facturados = hl_convertido = 0.0
        fill_num = fill_den = 0.0
        atendidos = 0                  # completada en el sistema O facturado en AxisPos
        facturados_sin_completar = 0   # facturado pero nunca marcado completada
        dom_total = dom_convertidos = 0
        dom_hl = dom_hl_convertido = 0.0
        lead_dom_sum = lead_dom_n = 0      # lead time con domicilio
        lead_sin_sum = lead_sin_n = 0      # lead time sin domicilio

        for p in pedidos:
            lineas = items.get(p.id, [])
            cantidad = sum(int(l.cantidad) for l in lineas)
            hl = sum(_hl(l.codigo, int(l.cantidad)) for l in lineas)
            es_convertido = p.primera_factura is not None
            es_domicilio = bool(p.requiere_domicilio)
            facturado = float(p.cantidad_facturada or 0)

            total += 1
            blisters_pedidos += cantidad
            hl_pedidos += hl
            estados[p.estado] += 1
            if es_convertido or p.estado == ESTADO_COMPLETADA:
                atendidos += 1
            if es_convertido and p.estado != ESTADO_COMPLETADA:
                facturados_sin_completar += 1

            if es_convertido:
                convertidos += 1
                # HL of the pedidos that converted, un-prorated. This is what the
                # HL conversion *rate* divides by hl_pedidos — deliberately not
                # hl_facturados below, which is prorated by what the factura
                # actually carried.
                hl_convertido += hl
                blisters_facturados += facturado
                # Facturado blisters are invoice-wide, so HL facturado is derived
                # from the pedido's own SKU mix — the only mix we actually know.
                hl_facturados += hl * min(1.0, facturado / cantidad) if cantidad else 0.0
                dias = max((p.primera_factura - p.fecha).days, 0)
                leadtime[dias] += 1
                if es_domicilio:
                    lead_dom_sum += dias
                    lead_dom_n += 1
                else:
                    lead_sin_sum += dias
                    lead_sin_n += 1
                if cantidad:
                    fill_num += min(facturado, cantidad)
                    fill_den += cantidad
                motivo = None
            else:
                motivo = _motivo(p.estado, p.fecha_comprometida, today)
                motivos[motivo] += 1

            if es_domicilio:
                dom_total += 1
                dom_hl += hl
                if es_convertido:
                    dom_convertidos += 1
                    dom_hl_convertido += hl

            # por sucursal × día
            key = (p.territorio, p.fecha)
            cell = por_dia.setdefault(key, {
                "territorio": p.territorio, "orden": p.orden, "fecha": p.fecha.isoformat(),
                "pedidos": 0, "convertidos": 0, "cantidad": 0.0,
                "hl": 0.0, "hl_convertido": 0.0,
            })
            cell["pedidos"] += 1
            cell["cantidad"] += cantidad
            cell["hl"] += hl
            if es_convertido:
                cell["convertidos"] += 1
                cell["hl_convertido"] += hl

            # por territorio — one fat accumulator feeding three response keys
            # (resumen, fugas, domicilio) so the three can never disagree.
            ter = por_territorio.setdefault(p.territorio, {
                "territorio": p.territorio, "orden": p.orden,
                "pedidos": 0, "convertidos": 0, "cantidad": 0.0,
                "hl": 0.0, "hl_convertido": 0.0,
                "no_convertidos": 0, "hl_no_convertido": 0.0,
                **{m: 0 for m in MOTIVOS},
                "dom_pedidos": 0, "dom_convertidos": 0,
                "dom_hl": 0.0, "dom_hl_convertido": 0.0,
            })
            ter["pedidos"] += 1
            ter["cantidad"] += cantidad
            ter["hl"] += hl
            if es_convertido:
                ter["convertidos"] += 1
                ter["hl_convertido"] += hl
            else:
                ter["no_convertidos"] += 1
                ter["hl_no_convertido"] += hl
                ter[motivo] += 1
            if es_domicilio:
                ter["dom_pedidos"] += 1
                ter["dom_hl"] += hl
                if es_convertido:
                    ter["dom_convertidos"] += 1
                    ter["dom_hl_convertido"] += hl

            # por vendedor (vendedor names are local to a sucursal)
            vkey = (p.territorio, p.vendedor or "Sin vendedor")
            ven = por_vendedor.setdefault(vkey, {
                "territorio": p.territorio, "vendedor": p.vendedor or "Sin vendedor",
                "pedidos": 0, "convertidos": 0, "cantidad": 0.0,
                "hl": 0.0, "hl_convertido": 0.0,
            })
            ven["pedidos"] += 1
            ven["cantidad"] += cantidad
            ven["hl"] += hl
            if es_convertido:
                ven["convertidos"] += 1
                ven["hl_convertido"] += hl

            # por SKU — a pedido counts once per SKU it contains
            for l in lineas:
                s = por_sku.setdefault(l.codigo, {
                    "sku": l.codigo, "pedidos": 0, "convertidos": 0,
                    "cantidad": 0.0, "hl": 0.0, "hl_convertido": 0.0,
                })
                linea_hl = _hl(l.codigo, int(l.cantidad))
                s["pedidos"] += 1
                s["cantidad"] += int(l.cantidad)
                s["hl"] += linea_hl
                if es_convertido:
                    s["convertidos"] += 1
                    s["hl_convertido"] += linea_hl

        # Every float the UI can show, so a new accumulator field is rounded by
        # simply being named here.
        float_keys = (
            "cantidad", "hl", "hl_convertido", "hl_no_convertido",
            "dom_hl", "dom_hl_convertido",
        )

        def finish(rows, sort_key):
            out = []
            for r in rows:
                r = dict(r)
                r["tasa_conversion"] = _rate(r["convertidos"], r["pedidos"])
                if "hl_convertido" in r:
                    r["tasa_conversion_hl"] = _rate(r["hl_convertido"], r["hl"])
                for k in float_keys:
                    if k in r:
                        r[k] = round(r[k], 2)
                out.append(r)
            return sorted(out, key=sort_key)

        por_territorio_rows = finish(por_territorio.values(), lambda r: r["orden"])
        for row in por_territorio_rows:
            row.update({
                k: v for k, v in facturas.get(row["territorio"], {
                    "facturas": 0, "facturas_con_codigo": 0,
                    "facturas_sin_codigo": 0, "cobertura_codigo": 0.0,
                }).items() if k != "orden"
            })

        # Three views over the same finished territory rows.
        resumen_keys = (
            "territorio", "orden", "pedidos", "convertidos", "cantidad", "hl",
            "hl_convertido", "tasa_conversion", "tasa_conversion_hl",
            "facturas", "facturas_con_codigo", "facturas_sin_codigo",
            "cobertura_codigo",
        )
        resumen_territorio = [{k: r[k] for k in resumen_keys} for r in por_territorio_rows]

        # A territory can bill without raising a single pedido — Moa and Palma
        # Soriano have no sucursal in the Sistema de Pedidos, so none of their
        # facturas can ever carry a código. Their cobertura is still real signal
        # (and it is what the cobertura KPI averages over), so list them here with
        # zero pedidos rather than let the table's total silently disagree with
        # the KPI card above it.
        con_pedidos = {r["territorio"] for r in por_territorio_rows}
        for nombre, f in facturas.items():
            if nombre in con_pedidos:
                continue
            resumen_territorio.append({
                "territorio": nombre, "orden": f["orden"],
                "pedidos": 0, "convertidos": 0, "cantidad": 0.0, "hl": 0.0,
                "hl_convertido": 0.0, "tasa_conversion": 0.0, "tasa_conversion_hl": 0.0,
                **{k: v for k, v in f.items() if k != "orden"},
            })
        resumen_territorio.sort(key=lambda r: r["orden"])
        fugas_territorio = [
            {
                "territorio": r["territorio"], "orden": r["orden"],
                "pedidos": r["pedidos"],
                "no_convertidos": r["no_convertidos"],
                "tasa_fuga": _rate(r["no_convertidos"], r["pedidos"]),
                "hl_no_convertido": r["hl_no_convertido"],
                **{m: r[m] for m in MOTIVOS},
            }
            for r in por_territorio_rows
        ]
        domicilio_territorio = [
            {k: r[k] for k in (
                "territorio", "orden", "pedidos", "convertidos", "hl", "hl_convertido",
                "dom_pedidos", "dom_convertidos", "dom_hl", "dom_hl_convertido",
            )}
            for r in por_territorio_rows
        ]

        facturas_total = sum(f["facturas"] for f in facturas.values())
        facturas_con_codigo = sum(f["facturas_con_codigo"] for f in facturas.values())

        sku_orden = {s["codigo"]: s["orden"] for s in config.PARRANDA_SKUS}

        # Stages are strict subsets so the funnel can only ever shrink. "Atendidos"
        # is deliberately the union of completada-in-the-system and facturado-in-
        # AxisPos: the two disagree in both directions (pedidos invoiced while
        # still en_proceso, and pedidos marked completada that were never
        # invoiced), and a plain "Completados" stage would sit *below* Facturados
        # and read as a bug. Both disagreements are reported as their own numbers.
        embudo = [
            {"etapa": "Levantados", "pedidos": total},
            {"etapa": "Atendidos", "pedidos": atendidos},
            {"etapa": "Facturados", "pedidos": convertidos},
        ]

        return jsonify({
            "meta": {
                "fecha_inicio": fecha_inicio.isoformat(),
                "fecha_fin": fecha_fin.isoformat(),
                "total_pedidos": total,
                "pedidos_convertidos": convertidos,
                "tasa_conversion": _rate(convertidos, total),
                "blisters_pedidos": round(blisters_pedidos, 2),
                "blisters_facturados": round(blisters_facturados, 2),
                "hl_pedidos": round(hl_pedidos, 2),
                "hl_facturados": round(hl_facturados, 2),
                "hl_convertido": round(hl_convertido, 2),
                "tasa_conversion_hl": _rate(hl_convertido, hl_pedidos),
                "fill_rate": _rate(int(fill_num), int(fill_den)),
                "pedidos_domicilio": dom_total,
                "hl_domicilio": round(dom_hl, 2),
                "tasa_domicilio": _rate(dom_total, total),
                "tasa_conversion_domicilio": _rate(dom_convertidos, dom_total),
                "tasa_conversion_sin_domicilio": _rate(convertidos - dom_convertidos, total - dom_total),
                "tasa_conversion_hl_domicilio": _rate(dom_hl_convertido, dom_hl),
                "tasa_conversion_hl_sin_domicilio": _rate(
                    hl_convertido - dom_hl_convertido, hl_pedidos - dom_hl
                ),
                "leadtime_promedio_domicilio": round(lead_dom_sum / lead_dom_n, 1) if lead_dom_n else None,
                "leadtime_promedio_sin_domicilio": round(lead_sin_sum / lead_sin_n, 1) if lead_sin_n else None,
                "completados_sistema": estados.get(ESTADO_COMPLETADA, 0),
                "facturados_sin_completar": facturados_sin_completar,
                "completados_sin_factura": motivos.get(MOTIVO_COMPLETADA_SIN_FACTURA, 0),
                "facturas_total": facturas_total,
                "facturas_con_codigo": facturas_con_codigo,
                "facturas_sin_codigo": facturas_total - facturas_con_codigo,
                "cobertura_codigo": _rate(facturas_con_codigo, facturas_total),
            },
            "embudo": embudo,
            "estados": [{"estado": k, "pedidos": v} for k, v in sorted(estados.items())],
            "motivos": [{"motivo": k, "pedidos": v} for k, v in sorted(motivos.items(), key=lambda x: -x[1])],
            "por_dia": finish(por_dia.values(), lambda r: (r["orden"], r["fecha"])),
            "por_territorio": resumen_territorio,
            "fugas_por_territorio": fugas_territorio,
            "por_domicilio": domicilio_territorio,
            # Uncapped on purpose: the Vendedores sub-tab searches and filters this
            # list client-side, and there are only a few dozen vendedores.
            "por_vendedor": finish(por_vendedor.values(), lambda r: -r["pedidos"]),
            "por_sku": finish(por_sku.values(), lambda r: sku_orden.get(r["sku"], 99)),
            "leadtime": [{"dias": d, "pedidos": n} for d, n in sorted(leadtime.items())],
        })
    finally:
        db.close()

