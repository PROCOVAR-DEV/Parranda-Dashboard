"""
Extract pedidos from the Sistema de Pedidos REST API (pedidos.procovar.cloud).

Auth is a single API key sent as the `x-api-key` header. The key inherits the
identity of the user that issued it, so it must be created by a Super Admin
account — otherwise every endpoint answers "No hay sucursal disponible para esta
solicitud" and `sucursalId=all` is refused.

Only /orders is used: unlike /reports/* it returns the full pedido including its
items in one paginated call. Note the date parameters here are fechaDesde /
fechaHasta, while /reports/* uses fechaInicio / fechaFin.

Pedidos with no Parranda line are dropped entirely (the catalog also carries
arroz, refrescos, papel higienico...), as are sucursales outside
config.PEDIDOS_SUCURSAL_MAP (GRANMA = Bayamo, excluded from this dashboard).
"""
from __future__ import annotations

import logging
from datetime import date, datetime

import requests

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config

logger = logging.getLogger(__name__)

PAGE_SIZE = 100
REQUEST_TIMEOUT = 60
MAX_PAGES = 2000  # hard stop so a broken pagination contract can't loop forever


class PedidosAPIError(RuntimeError):
    """The pedidos API is unreachable, unauthorized, or answered unexpectedly."""


def _headers() -> dict:
    settings = config.pedidos_settings()
    if not settings["key"]:
        raise PedidosAPIError(
            "Falta la API key del Sistema de Pedidos (Admin → Datos o PEDIDOS_API_KEY)."
        )
    return {"x-api-key": settings["key"], "Accept": "application/json"}


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def fetch_sucursales() -> list[dict]:
    """[{id, nombre, codigo}] straight from the API (used to validate the map)."""
    settings = config.pedidos_settings()
    response = requests.get(
        f"{settings['url']}/sucursales", headers=_headers(), timeout=REQUEST_TIMEOUT
    )
    if not response.ok:
        raise PedidosAPIError(f"GET /sucursales → {response.status_code}: {response.text[:200]}")
    return response.json()


def _sucursal_lookup() -> dict[str, str]:
    """Sucursal id (cuid) → canonical territory nombre, for the mapped sucursales only."""
    lookup: dict[str, str] = {}
    unmapped: list[str] = []
    for sucursal in fetch_sucursales():
        territorio = config.PEDIDOS_SUCURSAL_MAP.get((sucursal.get("codigo") or "").upper())
        if territorio:
            lookup[sucursal["id"]] = territorio
        else:
            unmapped.append(f"{sucursal.get('nombre')} ({sucursal.get('codigo')})")
    if unmapped:
        # Expected for GRANMA; anything else means a new sucursal went live and
        # PEDIDOS_SUCURSAL_MAP needs an entry, so it must be visible in the log.
        logger.info("Sucursales sin territorio mapeado (pedidos ignorados): %s", ", ".join(unmapped))
    return lookup


def _parranda_items(raw_items: list[dict]) -> list[dict]:
    """Keep only lines that map to one of the 5 SKUs, aggregated per SKU code."""
    aggregated: dict[str, dict] = {}
    for item in raw_items or []:
        codigo = config.pedidos_sku_code(item.get("producto"))
        if codigo is None:
            continue
        blisters = config.pedido_blisters(item.get("unidades"), item.get("packs"))
        row = aggregated.setdefault(codigo, {"sku_codigo": codigo, "cantidad": 0, "unidades": 0})
        row["cantidad"] += blisters
        row["unidades"] += int(item.get("unidades") or 0)
    return list(aggregated.values())


def extract_pedidos(fecha_inicio: date, fecha_fin: date) -> list[dict]:
    """
    All Parranda-bearing pedidos in the range, across every mapped sucursal.

    Returns dicts shaped for etl.load.upsert_pedidos(). Raises PedidosAPIError if
    the API is unreachable or the key lacks global-admin scope — the caller
    records that as a failed source rather than silently reporting zero pedidos.
    """
    settings = config.pedidos_settings()
    sucursales = _sucursal_lookup()
    if not sucursales:
        raise PedidosAPIError(
            "GET /sucursales no devolvió sucursales mapeables. "
            "¿La API key fue emitida por un usuario Super Admin?"
        )

    logger.info("Extracting pedidos %s..%s", fecha_inicio, fecha_fin)
    rows: list[dict] = []
    seen: set[str] = set()
    page = 1

    while page <= MAX_PAGES:
        response = requests.get(
            f"{settings['url']}/orders",
            headers=_headers(),
            params={
                "sucursalId": "all",
                "limit": PAGE_SIZE,
                "page": page,
                "incluirArchivados": "1",
                "fechaDesde": fecha_inicio.isoformat(),
                "fechaHasta": fecha_fin.isoformat(),
            },
            timeout=REQUEST_TIMEOUT,
        )
        if not response.ok:
            raise PedidosAPIError(f"GET /orders page={page} → {response.status_code}: {response.text[:200]}")

        payload = response.json()
        for pedido in payload.get("data", []):
            territorio = sucursales.get(pedido.get("sucursalId"))
            if territorio is None:
                continue
            items = _parranda_items(pedido.get("items"))
            if not items:
                continue
            fecha = _parse_date(pedido.get("fecha")) or _parse_date(pedido.get("createdAt"))
            if fecha is None:
                logger.warning("Pedido %s sin fecha utilizable, ignorado", pedido.get("folio"))
                continue
            ext_id = pedido["id"]
            if ext_id in seen:   # defensive: rows shifting between pages mid-scan
                continue
            seen.add(ext_id)

            cliente = pedido.get("cliente") or {}
            vendedor = pedido.get("vendedor") or {}
            rows.append({
                "pedido_ext_id": ext_id,
                "folio": (pedido.get("folio") or "").strip().upper(),
                "territorio": territorio,
                "sucursal_codigo": next(
                    (c for c, t in config.PEDIDOS_SUCURSAL_MAP.items() if t == territorio), ""
                ),
                "vendedor": (vendedor.get("nombre") or "").strip()[:200],
                "cliente_codigo": (cliente.get("codigo") or None),
                "cliente_nombre": (cliente.get("nombre") or "").strip()[:500],
                "estado": pedido.get("estado") or "en_proceso",
                "fecha": fecha,
                "fecha_comprometida": _parse_date(pedido.get("fecha_comprometida")),
                "completed_at": _parse_datetime(pedido.get("completedAt")),
                "requiere_domicilio": bool(pedido.get("requiere_domicilio")),
                "pedido_cobrado": pedido.get("pedido_cobrado"),
                "archivado": bool(pedido.get("archivedAt")),
                "items": items,
            })

        pagination = payload.get("pagination") or {}
        if page >= int(pagination.get("totalPages") or 1):
            break
        page += 1

    logger.info("Extracted %d pedidos con Parranda", len(rows))
    return rows
