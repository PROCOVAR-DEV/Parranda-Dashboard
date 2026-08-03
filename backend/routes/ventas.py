"""
/api/ventas      — aggregated NET Parranda sales (gross − devoluciones), in blisters
/api/territorios — canonical territory list
/api/skus        — the 5-SKU catalog
"""
from __future__ import annotations

from datetime import date

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func

bp = Blueprint("ventas", __name__)


def _first_of_month() -> date:
    today = date.today()
    return date(today.year, today.month, 1)


def parse_date(value: str | None, default: date) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError:
        return default


@bp.route("/territorios")
@jwt_required()
def get_territorios():
    from app import get_db
    from models import Territory

    db = get_db()
    try:
        territories = db.query(Territory).order_by(Territory.orden).all()
        return jsonify([t.to_dict() for t in territories])
    finally:
        db.close()


@bp.route("/skus")
@jwt_required()
def get_skus():
    from app import get_db
    from models import SKU

    db = get_db()
    try:
        skus = db.query(SKU).order_by(SKU.orden).all()
        return jsonify([s.to_dict() for s in skus])
    finally:
        db.close()


def _query_grouped(db, model, fecha_inicio, fecha_fin, territorios_filter, group_by):
    """Aggregate ventas or devoluciones by territorio×sku or fecha×sku."""
    from models import SKU, Territory

    if group_by == "fecha_sku":
        dims = [model.fecha.label("fecha")]
        group_cols = [model.fecha]
        order_cols = [model.fecha]
    else:  # territorio_sku
        dims = [Territory.nombre.label("territorio"), Territory.orden.label("territorio_orden")]
        group_cols = [Territory.nombre, Territory.orden]
        order_cols = [Territory.orden]

    q = (
        db.query(
            *dims,
            SKU.codigo.label("sku_codigo"),
            SKU.nombre.label("sku_nombre"),
            SKU.orden.label("sku_orden"),
            func.sum(model.cantidad).label("cantidad"),
            func.sum(model.importe_usd).label("importe_usd"),
        )
        .join(Territory, model.territory_id == Territory.id)
        .join(SKU, model.sku_id == SKU.id)
        .filter(model.fecha >= fecha_inicio, model.fecha <= fecha_fin)
    )
    if territorios_filter:
        q = q.filter(Territory.nombre.in_(territorios_filter))

    return q.group_by(*group_cols, SKU.codigo, SKU.nombre, SKU.orden).order_by(*order_cols, SKU.orden).all()


@bp.route("/ventas")
@jwt_required()
def get_ventas():
    """
    NET Parranda sales rows.

    Query params:
      fecha_inicio  YYYY-MM-DD (default: first of current month)
      fecha_fin     YYYY-MM-DD (default: today)
      territorio    repeatable (omit = all 9)
      group_by      territorio_sku (default) | fecha_sku
    """
    from app import get_db
    from models import Devolucion, Venta

    fecha_inicio = parse_date(request.args.get("fecha_inicio"), _first_of_month())
    fecha_fin = parse_date(request.args.get("fecha_fin"), date.today())
    territorios_filter = request.args.getlist("territorio")
    group_by = request.args.get("group_by", "territorio_sku")
    if group_by not in ("territorio_sku", "fecha_sku"):
        group_by = "territorio_sku"

    db = get_db()
    try:
        ventas = _query_grouped(db, Venta, fecha_inicio, fecha_fin, territorios_filter, group_by)
        devs = _query_grouped(db, Devolucion, fecha_inicio, fecha_fin, territorios_filter, group_by)
    finally:
        db.close()

    def key(r):
        dim = r.fecha.isoformat() if group_by == "fecha_sku" else r.territorio
        return (dim, r.sku_codigo)

    dev_lookup = {key(r): (int(r.cantidad or 0), float(r.importe_usd or 0)) for r in devs}

    rows = []
    for r in ventas:
        dev_cant, dev_imp = dev_lookup.get(key(r), (0, 0.0))
        net_cant = int(r.cantidad or 0) - dev_cant
        net_imp = float(r.importe_usd or 0) - dev_imp
        if net_cant == 0 and net_imp == 0.0:
            continue
        row = {
            "sku_codigo": r.sku_codigo,
            "sku_nombre": r.sku_nombre,
            "cantidad": net_cant,
            "importe_usd": round(net_imp, 2),
        }
        if group_by == "fecha_sku":
            row["fecha"] = r.fecha.isoformat()
        else:
            row["territorio"] = r.territorio
        rows.append(row)

    return jsonify({
        "meta": {
            "fecha_inicio": fecha_inicio.isoformat(),
            "fecha_fin": fecha_fin.isoformat(),
            "total_cantidad": sum(r["cantidad"] for r in rows),
        },
        "rows": rows,
    })
