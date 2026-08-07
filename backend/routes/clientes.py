"""
/api/clientes-compras — client purchase analytics for Parranda SKUs.

Returns:
  por_territorio: [{ territorio, clientes_unicos, compras, compras_por_cliente }]
  por_dia:        [{ fecha, clientes_unicos }]
  top_clientes:   [{ territorio, partner_nombre, compras, skus_distintos }]

"compras" (ventas realizadas) = COUNT(DISTINCT (fecha, partner)): all purchases by
one client in one day count as a single compra.

partner_id is local per AxisPos territory database, so cross-territory TOTALS are
always the SUM of per-territory distinct counts — never a global DISTINCT.
"""
from __future__ import annotations

from datetime import date

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import String, cast, func

from cache_reportes import cachear_reporte
from routes.ventas import parse_date

bp = Blueprint("clientes", __name__)

TOP_CLIENTES_LIMIT = 10


@bp.route("/clientes-compras")
@jwt_required()
@cachear_reporte("clientes")
def get_clientes_compras():
    """
    Query params:
      fecha_inicio  YYYY-MM-DD (default: first of current month)
      fecha_fin     YYYY-MM-DD (default: today)
      territorio    repeatable (omit = all 9)
    """
    from app import get_db
    from models import Territory, VentaCliente

    today = date.today()
    fecha_inicio = parse_date(request.args.get("fecha_inicio"), date(today.year, today.month, 1))
    fecha_fin = parse_date(request.args.get("fecha_fin"), today)
    territorios_filter = request.args.getlist("territorio")

    db = get_db()
    try:
        base_filter = [VentaCliente.fecha >= fecha_inicio, VentaCliente.fecha <= fecha_fin]
        compra_key = func.concat(cast(VentaCliente.fecha, String), "|", cast(VentaCliente.partner_id, String))

        # ── Per territory: unique clients + compras ──────────────────────────
        q_ter = (
            db.query(
                Territory.nombre.label("territorio"),
                Territory.orden.label("orden"),
                func.count(func.distinct(VentaCliente.partner_id)).label("clientes_unicos"),
                func.count(func.distinct(compra_key)).label("compras"),
            )
            .join(Territory, VentaCliente.territory_id == Territory.id)
            .filter(*base_filter)
        )
        if territorios_filter:
            q_ter = q_ter.filter(Territory.nombre.in_(territorios_filter))
        por_territorio = []
        for r in q_ter.group_by(Territory.nombre, Territory.orden).order_by(Territory.orden).all():
            clientes = int(r.clientes_unicos)
            compras = int(r.compras)
            por_territorio.append({
                "territorio": r.territorio,
                "clientes_unicos": clientes,
                "compras": compras,
                "compras_por_cliente": round(compras / clientes, 2) if clientes else 0,
            })

        # ── Per day: per-territory distinct counts summed in Python ──────────
        q_dia = (
            db.query(
                VentaCliente.fecha.label("fecha"),
                VentaCliente.territory_id.label("territory_id"),
                func.count(func.distinct(VentaCliente.partner_id)).label("clientes_unicos"),
            )
            .join(Territory, VentaCliente.territory_id == Territory.id)
            .filter(*base_filter)
        )
        if territorios_filter:
            q_dia = q_dia.filter(Territory.nombre.in_(territorios_filter))
        q_dia = q_dia.group_by(VentaCliente.fecha, VentaCliente.territory_id).order_by(VentaCliente.fecha)

        por_dia_map: dict[str, int] = {}
        for r in q_dia.all():
            key = r.fecha.isoformat()
            por_dia_map[key] = por_dia_map.get(key, 0) + int(r.clientes_unicos)
        por_dia = [{"fecha": f, "clientes_unicos": c} for f, c in sorted(por_dia_map.items())]

        # ── Top clients by compras (within selection) ────────────────────────
        q_top = (
            db.query(
                Territory.nombre.label("territorio"),
                VentaCliente.partner_id,
                func.max(VentaCliente.partner_nombre).label("partner_nombre"),
                func.count(func.distinct(compra_key)).label("compras"),
                func.count(func.distinct(VentaCliente.sku_id)).label("skus_distintos"),
            )
            .join(Territory, VentaCliente.territory_id == Territory.id)
            .filter(*base_filter)
        )
        if territorios_filter:
            q_top = q_top.filter(Territory.nombre.in_(territorios_filter))
        q_top = (
            q_top.group_by(Territory.nombre, VentaCliente.territory_id, VentaCliente.partner_id)
            .order_by(func.count(func.distinct(compra_key)).desc())
            .limit(TOP_CLIENTES_LIMIT)
        )
        top_clientes = [
            {
                "territorio": r.territorio,
                "partner_nombre": r.partner_nombre,
                "compras": int(r.compras),
                "skus_distintos": int(r.skus_distintos),
            }
            for r in q_top.all()
        ]

        total_clientes = sum(r["clientes_unicos"] for r in por_territorio)
        total_compras = sum(r["compras"] for r in por_territorio)

        return jsonify({
            "meta": {
                "fecha_inicio": fecha_inicio.isoformat(),
                "fecha_fin": fecha_fin.isoformat(),
                "total_clientes": total_clientes,
                "total_compras": total_compras,
                "compras_por_cliente": round(total_compras / total_clientes, 2) if total_clientes else 0,
            },
            "por_territorio": por_territorio,
            "por_dia": por_dia,
            "top_clientes": top_clientes,
        })
    finally:
        db.close()
