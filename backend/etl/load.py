"""Load extracted rows into PostgreSQL via upserts (refresh never deletes)."""
from __future__ import annotations

import logging

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from models import (
    Devolucion, FacturaObservacion, Pedido, PedidoItem, SKU, Territory, Venta, VentaCliente,
)

logger = logging.getLogger(__name__)


def _lookup_maps(db: Session) -> tuple[dict, dict]:
    territories = {t.nombre: t.id for t in db.query(Territory).all()}
    skus = {s.codigo: s.id for s in db.query(SKU).all()}
    return territories, skus


def _upsert_fact_rows(db: Session, model, rows: list[dict]) -> int:
    """Upsert ventas/devoluciones rows. Returns number of rows written."""
    if not rows:
        return 0
    territories, skus = _lookup_maps(db)
    payload = []
    for r in rows:
        territory_id = territories.get(r["territorio"])
        sku_id = skus.get(r["sku_codigo"])
        if territory_id is None or sku_id is None:
            logger.warning("Skipping row with unknown territory/sku: %s", r)
            continue
        payload.append({
            "fecha": r["fecha"],
            "territory_id": territory_id,
            "sku_id": sku_id,
            "cantidad": int(r["cantidad"]),
            "importe_usd": round(float(r["importe_usd"]), 2),
        })
    if not payload:
        return 0

    stmt = pg_insert(model.__table__).values(payload)
    stmt = stmt.on_conflict_do_update(
        index_elements=["fecha", "territory_id", "sku_id"],
        set_={
            "cantidad": stmt.excluded.cantidad,
            "importe_usd": stmt.excluded.importe_usd,
        },
    )
    db.execute(stmt)
    return len(payload)


def upsert_ventas(db: Session, rows: list[dict]) -> int:
    return _upsert_fact_rows(db, Venta, rows)


def upsert_devoluciones(db: Session, rows: list[dict]) -> int:
    return _upsert_fact_rows(db, Devolucion, rows)


def upsert_clientes(db: Session, rows: list[dict]) -> int:
    """Upsert client-level rows (ON CONFLICT DO NOTHING)."""
    if not rows:
        return 0
    territories, skus = _lookup_maps(db)
    payload = []
    for r in rows:
        territory_id = territories.get(r["territorio"])
        sku_id = skus.get(r["sku_codigo"])
        if territory_id is None or sku_id is None:
            continue
        payload.append({
            "fecha": r["fecha"],
            "territory_id": territory_id,
            "sku_id": sku_id,
            "partner_id": r["partner_id"],
            "partner_nombre": r["partner_nombre"],
            "acct": r["acct"],
        })
    if not payload:
        return 0

    stmt = pg_insert(VentaCliente.__table__).values(payload)
    stmt = stmt.on_conflict_do_nothing(
        index_elements=["fecha", "territory_id", "sku_id", "partner_id", "acct"],
    )
    db.execute(stmt)
    return len(payload)


def upsert_observaciones(db: Session, rows: list[dict]) -> int:
    """Upsert one row per AxisPos factura + its parsed folio (ON CONFLICT DO UPDATE)."""
    if not rows:
        return 0
    territories, _ = _lookup_maps(db)
    payload = []
    for r in rows:
        territory_id = territories.get(r["territorio"])
        if territory_id is None:
            logger.warning("Skipping observacion with unknown territory: %s", r["territorio"])
            continue
        payload.append({
            "fecha": r["fecha"],
            "territory_id": territory_id,
            "acct": r["acct"],
            "partner_id": r["partner_id"],
            "partner_nombre": r["partner_nombre"],
            "observacion": r["observacion"],
            "folio_extraido": r["folio_extraido"],
            "cantidad": int(r["cantidad"]),
            "importe_usd": round(float(r["importe_usd"]), 2),
        })
    if not payload:
        return 0

    stmt = pg_insert(FacturaObservacion.__table__).values(payload)
    # DO UPDATE, not DO NOTHING: a facturador can edit the observacion after the
    # fact (pasting a code that was missing), and that correction has to land.
    stmt = stmt.on_conflict_do_update(
        index_elements=["fecha", "territory_id", "acct"],
        set_={
            "partner_id": stmt.excluded.partner_id,
            "partner_nombre": stmt.excluded.partner_nombre,
            "observacion": stmt.excluded.observacion,
            "folio_extraido": stmt.excluded.folio_extraido,
            "cantidad": stmt.excluded.cantidad,
            "importe_usd": stmt.excluded.importe_usd,
        },
    )
    db.execute(stmt)
    return len(payload)


def upsert_pedidos(db: Session, rows: list[dict]) -> int:
    """
    Upsert pedidos and their Parranda lines.

    A pedido's estado and item set change over its life (en_proceso → completada,
    quantities edited), so both are updated in place. Item lines are replaced
    rather than merged: a line the vendedor removed must disappear, and the
    pedido row itself is never deleted, so history is preserved.
    """
    if not rows:
        return 0
    territories, skus = _lookup_maps(db)
    written = 0

    for r in rows:
        territory_id = territories.get(r["territorio"])
        if territory_id is None:
            logger.warning("Skipping pedido %s with unknown territory: %s", r["folio"], r["territorio"])
            continue

        stmt = pg_insert(Pedido.__table__).values({
            "pedido_ext_id": r["pedido_ext_id"],
            "folio": r["folio"],
            "territory_id": territory_id,
            "sucursal_codigo": r["sucursal_codigo"],
            "vendedor": r["vendedor"],
            "cliente_codigo": r["cliente_codigo"],
            "cliente_nombre": r["cliente_nombre"],
            "estado": r["estado"],
            "fecha": r["fecha"],
            "fecha_comprometida": r["fecha_comprometida"],
            "completed_at": r["completed_at"],
            "requiere_domicilio": r["requiere_domicilio"],
            "pedido_cobrado": r["pedido_cobrado"],
            "archivado": r["archivado"],
        })
        stmt = stmt.on_conflict_do_update(
            index_elements=["pedido_ext_id"],
            set_={
                "folio": stmt.excluded.folio,
                "territory_id": stmt.excluded.territory_id,
                "sucursal_codigo": stmt.excluded.sucursal_codigo,
                "vendedor": stmt.excluded.vendedor,
                "cliente_codigo": stmt.excluded.cliente_codigo,
                "cliente_nombre": stmt.excluded.cliente_nombre,
                "estado": stmt.excluded.estado,
                "fecha": stmt.excluded.fecha,
                "fecha_comprometida": stmt.excluded.fecha_comprometida,
                "completed_at": stmt.excluded.completed_at,
                "requiere_domicilio": stmt.excluded.requiere_domicilio,
                "pedido_cobrado": stmt.excluded.pedido_cobrado,
                "archivado": stmt.excluded.archivado,
            },
        ).returning(Pedido.__table__.c.id)
        pedido_id = db.execute(stmt).scalar_one()

        db.query(PedidoItem).filter(PedidoItem.pedido_id == pedido_id).delete(synchronize_session=False)
        for item in r["items"]:
            sku_id = skus.get(item["sku_codigo"])
            if sku_id is None:
                continue
            db.add(PedidoItem(
                pedido_id=pedido_id,
                sku_id=sku_id,
                cantidad=int(item["cantidad"]),
                unidades=int(item["unidades"]),
            ))
        written += 1

    return written
