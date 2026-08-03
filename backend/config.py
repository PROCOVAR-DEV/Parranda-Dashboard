"""
Central configuration for the Procovar - Parranda dashboard backend.

All external connection settings live here so the future VPS migration
only needs to touch this file (or the env vars / config.json it reads).
"""
from __future__ import annotations

import json
import os

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

# ── PostgreSQL (local dashboard store) ────────────────────────────────────────

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:0612@localhost:5432/parranda",
)

# ── AxisPos MySQL source ──────────────────────────────────────────────────────

_DEFAULTS = {
    "axispos_host": "192.168.1.3",
    "axispos_port": 3306,
    "axispos_user": "root",
    "axispos_password": "root",
    # Sistema de Pedidos (see PEDIDOS section below). Key is issued from
    # Panel -> Configuracion -> API Keys by a Super Admin account.
    # The /api suffix is required: the bare host serves the web frontend.
    "pedidos_api_url": "https://pedidos.procovar.cloud/api",
    "pedidos_api_key": "",
}


def _load_runtime_config() -> dict:
    """Read config.json next to this file; missing/invalid file → defaults."""
    try:
        with open(RUNTIME_CONFIG_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        return {**_DEFAULTS, **data}
    except (OSError, ValueError):
        return dict(_DEFAULTS)


def save_runtime_config(updates: dict) -> dict:
    """Persist AxisPos connection overrides to config.json and return merged config."""
    current = _load_runtime_config()
    current.update({k: v for k, v in updates.items() if k in _DEFAULTS})
    with open(RUNTIME_CONFIG_PATH, "w", encoding="utf-8") as fh:
        json.dump({k: current[k] for k in _DEFAULTS}, fh, indent=2)
    return current


def axispos_settings() -> dict:
    """Current AxisPos connection settings (re-read on every call).

    Env vars (AXISPOS_HOST/PORT/USER/PASSWORD) take precedence over config.json,
    which is useful for Docker/Kubernetes deployments where secrets live in the
    environment rather than in a file.
    """
    cfg = _load_runtime_config()
    cfg["axispos_host"] = os.environ.get("AXISPOS_HOST") or cfg["axispos_host"]
    cfg["axispos_port"] = int(os.environ.get("AXISPOS_PORT") or cfg["axispos_port"])
    cfg["axispos_user"] = os.environ.get("AXISPOS_USER") or cfg["axispos_user"]
    cfg["axispos_password"] = os.environ.get("AXISPOS_PASSWORD") or cfg["axispos_password"]
    return cfg


def pedidos_settings() -> dict:
    """Current Sistema de Pedidos API settings (re-read on every call)."""
    cfg = _load_runtime_config()
    return {
        "url": os.environ.get("PEDIDOS_API_URL") or cfg["pedidos_api_url"],
        "key": os.environ.get("PEDIDOS_API_KEY") or cfg["pedidos_api_key"],
    }


# ── Territories (canonical order — Bayamo/granma intentionally excluded) ──────

from datetime import date

# Moa and Palma Soriano went live as independent AxisPos installs on 2026-07-15.
# Before that date their sales were entered into the parent branch's database
# (Palma -> santiago, Moa -> holguinmoa), so those historical sales are already
# baked into Santiago's and Holguín's totals. fecha_min is a hard floor applied
# in etl/extract.py across every query type (ventas, devoluciones, clientes,
# stock) for these two entries only, to avoid double-counting. Never remove it
# or backfill data before this date for Moa/Palma Soriano.
_MOA_PALMA_CUTOVER = date(2026, 7, 15)

TERRITORY_DB_MAP: list[dict] = [
    {"orden": 1, "nombre": "Havana",           "db": "habana"},
    {"orden": 2, "nombre": "Sancti Spíritus",  "db": "sspiritus"},
    {"orden": 3, "nombre": "Camagüey",         "db": "camaguey"},
    {"orden": 4, "nombre": "Las Tunas",        "db": "tunas"},
    {"orden": 5, "nombre": "Holguín",          "db": "holguinmoa"},
    {"orden": 6, "nombre": "Moa",              "db": "moa",          "fecha_min": _MOA_PALMA_CUTOVER},
    {"orden": 7, "nombre": "Santiago de Cuba", "db": "santiago"},
    {"orden": 8, "nombre": "Palma Soriano",    "db": "palmasoriano", "fecha_min": _MOA_PALMA_CUTOVER},
    {"orden": 9, "nombre": "Guantánamo",       "db": "guantanamo"},
]

# ── Parranda SKU catalog ──────────────────────────────────────────────────────
# The dashboard tracks exactly these 5 SKUs. AxisPos product names are matched
# against the `match` rules; TONEL and PALLET products are always excluded.
# blister_units: units per blister. hl_factor: HL per blister.

PARRANDA_SKUS: list[dict] = [
    {"codigo": "P1500", "nombre": "Cerveza Parranda 1500ml Blister 6u", "hl_factor": 0.09,   "orden": 1},
    {"codigo": "P500",  "nombre": "Cerveza Parranda 500ml Blister 6u",  "hl_factor": 0.03,   "orden": 2},
    {"codigo": "P330",  "nombre": "Cerveza Parranda 330ml Blister 6u",  "hl_factor": 0.0198, "orden": 3},
    {"codigo": "M1500", "nombre": "Malta Guajira 1500ml Blister 6u",    "hl_factor": 0.09,   "orden": 4},
    {"codigo": "M330",  "nombre": "Malta Guajira 330ml Blister 6u",     "hl_factor": 0.0198, "orden": 5},
]

UNITS_PER_BLISTER = 6


def classify_parranda_sku(sku_nombre: str) -> str | None:
    """
    Map an AxisPos product name to one of the 5 canonical SKU codes.
    Returns None for anything that is not a tracked Parranda/Malta blister
    (TONEL, PALLET, other categories). Check "1500" before "500".
    """
    upper = (sku_nombre or "").upper()
    if "TONEL" in upper or "PALLET" in upper:
        return None
    malta = "MALTA" in upper or "GUAJIRA" in upper
    if "1500" in upper:
        return "M1500" if malta else "P1500"
    if "500" in upper:
        return "M500" if malta else "P500"   # M500 doesn't exist; guarded below
    if "330" in upper:
        return "M330" if malta else "P330"
    return None


_VALID_CODES = {s["codigo"] for s in PARRANDA_SKUS}


def parranda_sku_code(sku_nombre: str) -> str | None:
    """classify_parranda_sku() restricted to the 5 canonical codes."""
    code = classify_parranda_sku(sku_nombre)
    return code if code in _VALID_CODES else None


def hl_factor(codigo: str) -> float:
    for s in PARRANDA_SKUS:
        if s["codigo"] == codigo:
            return s["hl_factor"]
    raise KeyError(f"Unknown SKU code: {codigo}")


# ── Sistema de Pedidos (pedidos.procovar.cloud) ───────────────────────────────
# Migrated from pedidos.marketplacecuba.com on 2026-08-03; the old host still
# answers but stopped receiving pedidos after 2026-07-31. Sucursal ids (cuids)
# are identical on both hosts, so PEDIDOS_SUCURSAL_MAP is unaffected.
# Vendedores raise pedidos in the Parranda app; the Sistema de Pedidos processes
# them and copies "P-<folio>; V-<vendedor>; C-<cliente>;" to the clipboard, which
# the facturador pastes into the AxisPos observacion field (operations.Note).
# That folio is the only link between the two systems.

# Sucursal codigo (from GET /api/sucursales) -> canonical territory nombre.
# The pedidos system has 8 sucursales; GRANMA maps to Bayamo, which this
# dashboard excludes everywhere, so it is deliberately absent from this map and
# its pedidos are dropped at extraction time. Moa and Palma Soriano have no
# sucursal in the pedidos system at all (they bill through AxisPos only), so
# they will always show zero pedidos - that is correct, not a bug.
PEDIDOS_SUCURSAL_MAP: dict[str, str] = {
    "HAB": "Havana",
    "SS":  "Sancti Spíritus",
    "CAM": "Camagüey",
    "TUN": "Las Tunas",
    "HOL": "Holguín",
    "STG": "Santiago de Cuba",
    "GTO": "Guantánamo",
}

# Product names in the Sistema de Pedidos use a different convention from
# AxisPos: "PARRANDA 1.5L" / "PARRANDA 0.33L" instead of "Cerveza Parranda
# 1500ml Blister 6u". classify_parranda_sku() matches on the digit strings
# 1500/500/330 and therefore maps none of them, so pedidos need their own
# explicit table. An explicit table (rather than looser substring rules) also
# avoids false positives: the pedidos catalog carries non-Parranda products such
# as "REFRESCO SANTA LEMON 330ML CAJA 24U" that a "330" rule would wrongly claim.
PEDIDOS_SKU_NAMES: dict[str, str] = {
    "PARRANDA 1.5L":       "P1500",
    "PARRANDA 0.5L":       "P500",
    "PARRANDA 0.33L":      "P330",
    "MALTA GUAJIRA 1.5L":  "M1500",
    "MALTA GUAJIRA 0.33L": "M330",
}


def pedidos_sku_code(producto: str) -> str | None:
    """
    Map a Sistema de Pedidos product name to one of the 5 canonical SKU codes.
    Returns None for every other product in the catalog (arroz, refrescos,
    papel higienico...) so that only Parranda lines reach the dashboard.
    """
    return PEDIDOS_SKU_NAMES.get((producto or "").strip().upper())


# Units per pedido line: `unidades` are individual bottles and `packs` are
# blisters. Verified against production data (2026-07): every Parranda line has
# unidades / packs == UNITS_PER_BLISTER, while non-Parranda products use other
# ratios (10, 12, 24, 72...). AxisPos `cantidad` is blisters, so `packs` is the
# directly comparable figure and `unidades` must never be compared to it raw.
def pedido_blisters(unidades: int | None, packs: int | None) -> int:
    """Blisters for one pedido line, preferring `packs` and falling back to unidades/6."""
    if packs:
        return int(packs)
    return int(round((unidades or 0) / UNITS_PER_BLISTER))


# Folio as written into operations.Note, e.g.
#   "P-PJF25-260731-1043; V-...; C-...;"
# Real folios include split suffixes ("-1", "-2") and occasional letter suffixes
# ("PHA25-260730-2166G"), so the pattern stays permissive and stops at the
# delimiter rather than assuming a fixed shape.
FOLIO_PATTERN = r"P-\s*([A-Za-z0-9][A-Za-z0-9\-]*)"


def extract_folio(note: str | None) -> str | None:
    """Pull the pedido folio out of an AxisPos observacion; None if absent."""
    import re

    if not note:
        return None
    match = re.search(FOLIO_PATTERN, note)
    if not match:
        return None
    return match.group(1).strip().rstrip("-").upper() or None


# ── Flask / JWT ───────────────────────────────────────────────────────────────

JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "")  # generated+persisted at startup if empty
JWT_EXPIRES_HOURS = 8
API_PORT = int(os.environ.get("API_PORT", "5051"))
