"""
/api/stock — live Parranda stock queried directly from AxisPos MySQL.
Stock is never stored in PostgreSQL; each request queries the selected
territory databases in parallel threads.
"""
from __future__ import annotations

import concurrent.futures
import logging
from datetime import date

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config
from etl.extract import extract_stock_territory
from routes.ventas import parse_date

logger = logging.getLogger(__name__)

bp = Blueprint("stock", __name__)

TERRITORY_TIMEOUT = 15  # seconds per territory before treating as failed


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
    territorios_filter = set(request.args.getlist("territorio"))

    rows, failed = fetch_stock(fecha, territorios_filter)

    return jsonify({
        "meta": {"fecha": fecha.isoformat(), "territorios_fallidos": failed},
        "rows": rows,
    })
