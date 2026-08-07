"""
/api/portafolio — portfolio-diversity analytics over the 5 Parranda SKUs.

For each client (within one territory — partner_id is territory-local), counts
how many distinct SKUs they bought in the period. Returns:

  distribucion:  [{ depth: 1..5, por_territorio: {nombre: count}, total }]
  kpis:          { total_clientes, promedio_skus, pct_full_portfolio, pct_single_sku }
  combinaciones: [{ skus: ["P1500","M330"], clientes }]  (top 10)
  penetracion:   [{ sku_codigo, clientes, pct }]
"""
from __future__ import annotations

from collections import Counter
from datetime import date

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func

from cache_reportes import cachear_reporte
from routes.ventas import parse_date

bp = Blueprint("portafolio", __name__)


@bp.route("/portafolio")
@jwt_required()
@cachear_reporte("portafolio")
def get_portafolio():
    """
    Query params:
      fecha_inicio  YYYY-MM-DD (default: first of current month)
      fecha_fin     YYYY-MM-DD (default: today)
      territorio    repeatable (omit = all 9)
    """
    from app import get_db
    from models import SKU, Territory, VentaCliente

    today = date.today()
    fecha_inicio = parse_date(request.args.get("fecha_inicio"), date(today.year, today.month, 1))
    fecha_fin = parse_date(request.args.get("fecha_fin"), today)
    territorios_filter = request.args.getlist("territorio")

    db = get_db()
    try:
        territories = db.query(Territory).order_by(Territory.orden).all()
        skus = db.query(SKU).order_by(SKU.orden).all()
        n_skus = len(skus)
        sku_code = {s.id: s.codigo for s in skus}
        sku_orden = {s.codigo: s.orden for s in skus}

        # One row per (territory, partner, sku) — the basis for all analytics.
        q = (
            db.query(
                VentaCliente.territory_id,
                VentaCliente.partner_id,
                VentaCliente.sku_id,
            )
            .join(Territory, VentaCliente.territory_id == Territory.id)
            .filter(VentaCliente.fecha >= fecha_inicio, VentaCliente.fecha <= fecha_fin)
        )
        if territorios_filter:
            q = q.filter(Territory.nombre.in_(territorios_filter))
        q = q.group_by(VentaCliente.territory_id, VentaCliente.partner_id, VentaCliente.sku_id)

        # client (territory_id, partner_id) → set of sku codes
        client_skus: dict[tuple, set] = {}
        for territory_id, partner_id, sku_id in q.all():
            client_skus.setdefault((territory_id, partner_id), set()).add(sku_code[sku_id])
    finally:
        db.close()

    territory_by_id = {t.id: t.nombre for t in territories}
    nombres = [t.nombre for t in territories]

    # ── Distribution: depth (1..5) × territory ────────────────────────────────
    dist: dict[int, dict[str, int]] = {d: {n: 0 for n in nombres} for d in range(1, n_skus + 1)}
    combo_counter: Counter = Counter()
    pen_counter: Counter = Counter()
    total_clients = 0
    total_depth = 0

    for (territory_id, _partner), codes in client_skus.items():
        nombre = territory_by_id.get(territory_id)
        depth = len(codes)
        if nombre is None or depth == 0:
            continue
        total_clients += 1
        total_depth += depth
        dist[min(depth, n_skus)][nombre] += 1
        combo_counter[tuple(sorted(codes, key=lambda c: sku_orden.get(c, 99)))] += 1
        for c in codes:
            pen_counter[c] += 1

    distribucion = [
        {
            "depth": d,
            "por_territorio": dist[d],
            "total": sum(dist[d].values()),
        }
        for d in range(1, n_skus + 1)
    ]

    full = sum(dist[n_skus].values())
    single = sum(dist[1].values())
    kpis = {
        "total_clientes": total_clients,
        "promedio_skus": round(total_depth / total_clients, 2) if total_clients else 0,
        "pct_full_portfolio": round(full / total_clients * 100, 1) if total_clients else 0,
        "pct_single_sku": round(single / total_clients * 100, 1) if total_clients else 0,
    }

    combinaciones = [
        {"skus": list(combo), "clientes": count}
        for combo, count in combo_counter.most_common(10)
    ]

    penetracion = [
        {
            "sku_codigo": s.codigo,
            "clientes": pen_counter.get(s.codigo, 0),
            "pct": round(pen_counter.get(s.codigo, 0) / total_clients * 100, 1) if total_clients else 0,
        }
        for s in skus
    ]

    return jsonify({
        "meta": {"fecha_inicio": fecha_inicio.isoformat(), "fecha_fin": fecha_fin.isoformat()},
        "distribucion": distribucion,
        "kpis": kpis,
        "combinaciones": combinaciones,
        "penetracion": penetracion,
    })
