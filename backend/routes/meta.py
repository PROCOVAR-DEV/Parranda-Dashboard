"""
Monthly targets (metas) and the Real vs Meta assembly.

GET  /api/metas?mes=YYYY-MM        (admin) — meta grid + dias override for a month
POST /api/metas                    (admin) — upsert grid { mes, items: [...], dias_totales }
POST /api/metas/copy               (admin) — { from_mes, to_mes }
GET  /api/meta-real?mes=YYYY-MM    (all)   — data for the Real vs Meta tab (all values in HL)
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func

from auth import admin_required

bp = Blueprint("meta", __name__)


def _parse_mes(value: str | None) -> date:
    """'YYYY-MM' → first day of that month (default: current month)."""
    today = date.today()
    if value:
        try:
            year, month = value.split("-")
            return date(int(year), int(month), 1)
        except (ValueError, AttributeError):
            pass
    return date(today.year, today.month, 1)


def _weekdays_between(start: date, end: date) -> int:
    """Count Mon-Fri days in [start, end]. 0 if end < start."""
    count = 0
    d = start
    while d <= end:
        if d.weekday() < 5:
            count += 1
        d += timedelta(days=1)
    return count


def working_days(mes: date, override_total: int | None) -> tuple[int, int]:
    """
    Returns (dias_totales, dias_transcurridos) for the month.
    Totals = Mon-Fri count (or admin override). Transcurridos = Mon-Fri days
    from the 1st through yesterday (clamped to the month).
    """
    last_day = date(mes.year, mes.month, calendar.monthrange(mes.year, mes.month)[1])
    total = override_total if override_total else _weekdays_between(mes, last_day)

    yesterday = date.today() - timedelta(days=1)
    if yesterday < mes:
        transcurridos = 0
    else:
        transcurridos = _weekdays_between(mes, min(yesterday, last_day))
        if override_total:
            transcurridos = min(transcurridos, override_total)
    return total, transcurridos


# ── Admin: meta grid CRUD ─────────────────────────────────────────────────────

@bp.route("/metas")
@admin_required
def get_metas():
    from app import get_db
    from models import Meta, MetaMonthConfig, SKU, Territory

    mes = _parse_mes(request.args.get("mes"))
    db = get_db()
    try:
        metas = (
            db.query(Meta, Territory.nombre, SKU.codigo)
            .join(Territory, Meta.territory_id == Territory.id)
            .join(SKU, Meta.sku_id == SKU.id)
            .filter(Meta.mes == mes)
            .all()
        )
        cfg = db.query(MetaMonthConfig).filter(MetaMonthConfig.mes == mes).first()
        items = [
            {"territorio": nombre, "sku_codigo": codigo, "hl": float(m.hl)}
            for m, nombre, codigo in metas
        ]
        return jsonify({
            "mes": mes.strftime("%Y-%m"),
            "items": items,
            "dias_totales_override": cfg.dias_totales if cfg else None,
        })
    finally:
        db.close()


@bp.route("/metas", methods=["POST"])
@admin_required
def save_metas():
    from app import get_db
    from models import Meta, MetaMonthConfig, SKU, Territory

    data = request.get_json(silent=True) or {}
    mes = _parse_mes(data.get("mes"))
    items = data.get("items") or []

    db = get_db()
    try:
        territories = {t.nombre: t.id for t in db.query(Territory).all()}
        skus = {s.codigo: s.id for s in db.query(SKU).all()}

        for item in items:
            territory_id = territories.get(item.get("territorio"))
            sku_id = skus.get(item.get("sku_codigo"))
            if territory_id is None or sku_id is None:
                continue
            try:
                hl = round(float(item.get("hl") or 0), 2)
            except (TypeError, ValueError):
                continue
            existing = (
                db.query(Meta)
                .filter(Meta.mes == mes, Meta.territory_id == territory_id, Meta.sku_id == sku_id)
                .first()
            )
            if existing:
                existing.hl = hl
            else:
                db.add(Meta(mes=mes, territory_id=territory_id, sku_id=sku_id, hl=hl))

        # Working-days override (null/empty = auto)
        if "dias_totales" in data:
            raw = data.get("dias_totales")
            override = int(raw) if raw not in (None, "", 0, "0") else None
            cfg = db.query(MetaMonthConfig).filter(MetaMonthConfig.mes == mes).first()
            if cfg:
                cfg.dias_totales = override
            else:
                db.add(MetaMonthConfig(mes=mes, dias_totales=override))

        db.commit()
        return jsonify({"status": "ok"})
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@bp.route("/metas/copy", methods=["POST"])
@admin_required
def copy_metas():
    from app import get_db
    from models import Meta

    data = request.get_json(silent=True) or {}
    from_mes = _parse_mes(data.get("from_mes"))
    to_mes = _parse_mes(data.get("to_mes"))
    if from_mes == to_mes:
        return jsonify({"error": "Los meses deben ser distintos"}), 400

    db = get_db()
    try:
        source = db.query(Meta).filter(Meta.mes == from_mes).all()
        if not source:
            return jsonify({"error": "No hay metas en el mes de origen"}), 404
        copied = 0
        for m in source:
            existing = (
                db.query(Meta)
                .filter(Meta.mes == to_mes, Meta.territory_id == m.territory_id, Meta.sku_id == m.sku_id)
                .first()
            )
            if existing:
                existing.hl = m.hl
            else:
                db.add(Meta(mes=to_mes, territory_id=m.territory_id, sku_id=m.sku_id, hl=m.hl))
            copied += 1
        db.commit()
        return jsonify({"status": "ok", "copied": copied})
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ── Real vs Meta assembly ─────────────────────────────────────────────────────

def _net_hl_by_territory_sku(db, fecha_inicio: date, fecha_fin: date) -> dict[tuple, float]:
    """(territorio, sku_codigo) → net HL (ventas − devoluciones, blisters × factor)."""
    from models import Devolucion, SKU, Territory, Venta

    result: dict[tuple, float] = {}
    for model, sign in ((Venta, 1), (Devolucion, -1)):
        q = (
            db.query(
                Territory.nombre,
                SKU.codigo,
                SKU.hl_factor,
                func.sum(model.cantidad).label("cantidad"),
            )
            .join(Territory, model.territory_id == Territory.id)
            .join(SKU, model.sku_id == SKU.id)
            .filter(model.fecha >= fecha_inicio, model.fecha <= fecha_fin)
            .group_by(Territory.nombre, SKU.codigo, SKU.hl_factor)
        )
        for nombre, codigo, factor, cantidad in q.all():
            key = (nombre, codigo)
            result[key] = result.get(key, 0.0) + sign * int(cantidad or 0) * float(factor)
    return result


@bp.route("/meta-real")
@jwt_required()
def get_meta_real():
    """
    All values in HL — the frontend converts to blister/unidades.

    Returns per territory (canonical order) per SKU:
      meta_total, venta_acumulada, ultimo_crecimiento, stock
    plus meta: { mes, dias_totales, dias_transcurridos, fecha_ultimo_crecimiento,
                 stock_fallidos }
    """
    import calendar as _cal

    from app import get_db
    from models import Meta, MetaMonthConfig, SKU, Territory
    from routes.stock import fetch_stock
    import config as cfg

    mes = _parse_mes(request.args.get("mes"))
    last_day = date(mes.year, mes.month, _cal.monthrange(mes.year, mes.month)[1])
    today = date.today()

    # Accumulation window: month start → today (or whole month if past).
    fin_acum = min(today, last_day)
    # "Ultimo crecimiento" day: yesterday for the current month, else last day of month.
    if mes.year == today.year and mes.month == today.month:
        dia_crecimiento = today - timedelta(days=1)
    else:
        dia_crecimiento = last_day

    db = get_db()
    try:
        territories = db.query(Territory).order_by(Territory.orden).all()
        skus = db.query(SKU).order_by(SKU.orden).all()

        cfg_row = db.query(MetaMonthConfig).filter(MetaMonthConfig.mes == mes).first()
        dias_totales, dias_transcurridos = working_days(mes, cfg_row.dias_totales if cfg_row else None)

        metas_lookup: dict[tuple, float] = {}
        meta_rows = (
            db.query(Meta, Territory.nombre, SKU.codigo)
            .join(Territory, Meta.territory_id == Territory.id)
            .join(SKU, Meta.sku_id == SKU.id)
            .filter(Meta.mes == mes)
            .all()
        )
        for m, nombre, codigo in meta_rows:
            metas_lookup[(nombre, codigo)] = float(m.hl)

        ventas_acum = _net_hl_by_territory_sku(db, mes, fin_acum) if fin_acum >= mes else {}
        crecimiento = (
            _net_hl_by_territory_sku(db, dia_crecimiento, dia_crecimiento)
            if mes <= dia_crecimiento <= last_day else {}
        )
    finally:
        db.close()

    # Live stock (today) in HL
    stock_rows, stock_failed = fetch_stock(today)
    hl_factors = {s["codigo"]: s["hl_factor"] for s in cfg.PARRANDA_SKUS}
    stock_lookup: dict[tuple, float] = {}
    for r in stock_rows:
        key = (r["territorio"], r["sku_codigo"])
        stock_lookup[key] = stock_lookup.get(key, 0.0) + r["cantidad_actual"] * hl_factors[r["sku_codigo"]]

    territorios_payload = []
    for t in territories:
        sku_values = {}
        for s in skus:
            key = (t.nombre, s.codigo)
            sku_values[s.codigo] = {
                "meta_total": round(metas_lookup.get(key, 0.0), 4),
                "venta_acumulada": round(ventas_acum.get(key, 0.0), 4),
                "ultimo_crecimiento": round(crecimiento.get(key, 0.0), 4),
                "stock": round(stock_lookup.get(key, 0.0), 4),
            }
        territorios_payload.append({"territorio": t.nombre, "skus": sku_values})

    return jsonify({
        "meta": {
            "mes": mes.strftime("%Y-%m"),
            "dias_totales": dias_totales,
            "dias_transcurridos": dias_transcurridos,
            "fecha_ultimo_crecimiento": dia_crecimiento.isoformat(),
            "stock_fallidos": stock_failed,
            "sku_codigos": [s.codigo for s in skus],
        },
        "territorios": territorios_payload,
    })
