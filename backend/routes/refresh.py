"""
ETL refresh endpoints.

Refresh + status are available to ALL authenticated users (viewers can pull fresh
data); only the AxisPos server config stays admin-only.

POST /api/refresh           { fecha_inicio, fecha_fin } — background ETL for all territories
POST /api/refresh/retry     { territories: [], fecha_inicio, fecha_fin } — re-run failed ones
GET  /api/refresh/status    → { status, rows_upserted, failed_territories, started_at, finished_at }
GET/POST /api/config/server — AxisPos connection settings (admin only)
"""
from __future__ import annotations

import logging
import threading
from datetime import date, datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config
from auth import admin_required
from etl import extract, load, pedidos_extract
from routes.ventas import parse_date

logger = logging.getLogger(__name__)

bp = Blueprint("refresh", __name__)

_lock = threading.Lock()


def _run_etl(log_id: int, fecha_inicio: date, fecha_fin: date, territory_names: list[str] | None):
    """Background ETL: ventas → clientes → devoluciones per territory."""
    from app import SessionLocal
    from models import RefreshLog

    targets = [
        entry for entry in config.TERRITORY_DB_MAP
        if territory_names is None or entry["nombre"] in territory_names
    ]

    rows_upserted = 0
    failed: list[str] = []

    for entry in targets:
        nombre, db_name = entry["nombre"], entry["db"]
        fecha_min = entry.get("fecha_min")
        try:
            ventas_rows = extract.extract_territory(nombre, db_name, fecha_inicio, fecha_fin, fecha_min)
            clientes_rows = extract.extract_clientes_territory(nombre, db_name, fecha_inicio, fecha_fin, fecha_min)
            dev_rows = extract.extract_returns_territory(nombre, db_name, fecha_inicio, fecha_fin, fecha_min)
            obs_rows = extract.extract_observaciones_territory(nombre, db_name, fecha_inicio, fecha_fin, fecha_min)

            session = SessionLocal()
            try:
                rows_upserted += load.upsert_ventas(session, ventas_rows)
                rows_upserted += load.upsert_clientes(session, clientes_rows)
                rows_upserted += load.upsert_devoluciones(session, dev_rows)
                rows_upserted += load.upsert_observaciones(session, obs_rows)
                session.commit()
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        except Exception as exc:
            logger.error("ETL failed for %s: %s", nombre, exc)
            failed.append(nombre)

    # Pedidos come from the REST API, not per-territory MySQL, so they run once
    # after the territory loop. A pedidos failure is reported as its own pseudo
    # territory: the AxisPos side is still valid and must not be marked failed.
    if territory_names is None:
        try:
            pedidos_rows = pedidos_extract.extract_pedidos(fecha_inicio, fecha_fin)
            session = SessionLocal()
            try:
                rows_upserted += load.upsert_pedidos(session, pedidos_rows)
                session.commit()
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
        except Exception as exc:
            logger.error("ETL failed for Pedidos: %s", exc)
            failed.append("Pedidos")

    session = SessionLocal()
    try:
        log = session.get(RefreshLog, log_id)
        if log:
            log.finished_at = datetime.now()
            log.rows_upserted = rows_upserted
            log.failed_territories = ",".join(failed)
            total_sources = len(targets) + (1 if territory_names is None else 0)  # +1 = Pedidos
            log.status = "ok" if not failed else ("error" if len(failed) >= total_sources else "partial")
            session.commit()
    finally:
        session.close()


def _start_refresh(fecha_inicio: date, fecha_fin: date, territory_names: list[str] | None):
    from app import SessionLocal
    from models import RefreshLog

    with _lock:
        session = SessionLocal()
        try:
            running = (
                session.query(RefreshLog)
                .filter(RefreshLog.status == "running")
                .order_by(RefreshLog.id.desc())
                .first()
            )
            if running:
                return None  # already running
            log = RefreshLog(status="running")
            session.add(log)
            session.commit()
            log_id = log.id
        finally:
            session.close()

    thread = threading.Thread(
        target=_run_etl, args=(log_id, fecha_inicio, fecha_fin, territory_names), daemon=True
    )
    thread.start()
    return log_id


@bp.route("/refresh", methods=["POST"])
@jwt_required()
def trigger_refresh():
    data = request.get_json(silent=True) or {}
    today = date.today()
    fecha_inicio = parse_date(data.get("fecha_inicio"), date(today.year, today.month, 1))
    fecha_fin = parse_date(data.get("fecha_fin"), today)

    log_id = _start_refresh(fecha_inicio, fecha_fin, None)
    if log_id is None:
        return jsonify({"error": "Ya hay una actualización en curso"}), 409
    return jsonify({"status": "running", "log_id": log_id})


@bp.route("/refresh/retry", methods=["POST"])
@jwt_required()
def retry_refresh():
    data = request.get_json(silent=True) or {}
    territories = data.get("territories") or []
    if not territories:
        return jsonify({"error": "Lista de territorios requerida"}), 400
    today = date.today()
    fecha_inicio = parse_date(data.get("fecha_inicio"), date(today.year, today.month, 1))
    fecha_fin = parse_date(data.get("fecha_fin"), today)

    log_id = _start_refresh(fecha_inicio, fecha_fin, territories)
    if log_id is None:
        return jsonify({"error": "Ya hay una actualización en curso"}), 409
    return jsonify({"status": "running", "log_id": log_id})


@bp.route("/refresh/status")
@jwt_required()
def refresh_status():
    from app import get_db
    from models import RefreshLog

    db = get_db()
    try:
        log = db.query(RefreshLog).order_by(RefreshLog.id.desc()).first()
        if not log:
            return jsonify({"status": "idle"})
        return jsonify({
            "status": log.status,
            "rows_upserted": log.rows_upserted or 0,
            "failed_territories": [t for t in (log.failed_territories or "").split(",") if t],
            "started_at": log.started_at.isoformat() if log.started_at else None,
            "finished_at": log.finished_at.isoformat() if log.finished_at else None,
        })
    finally:
        db.close()


_SECRET_SETTINGS = ("axispos_password", "pedidos_api_key")


def _public_settings(settings: dict) -> dict:
    """Connection settings minus secrets, plus a flag so the UI can show if a key is set."""
    public = {k: v for k, v in settings.items() if k not in _SECRET_SETTINGS}
    public["pedidos_api_key_set"] = bool(settings.get("pedidos_api_key"))
    return public


@bp.route("/config/server", methods=["GET"])
@admin_required
def get_server_config():
    return jsonify(_public_settings(config.axispos_settings()))


@bp.route("/config/server", methods=["POST"])
@admin_required
def set_server_config():
    data = request.get_json(silent=True) or {}
    # An empty pedidos_api_key means "leave it alone" — the UI never receives the
    # current value back, so submitting the form must not wipe a stored key.
    if not (data.get("pedidos_api_key") or "").strip():
        data.pop("pedidos_api_key", None)
    updated = config.save_runtime_config(data)
    return jsonify(_public_settings(updated))
