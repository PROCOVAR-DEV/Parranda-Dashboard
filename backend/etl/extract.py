"""
Extract Parranda data from AxisPos MySQL databases (9 territories).

AxisPos schema used:
  operations  - one row per sale line item
                OperType 2/9/10 = sale, 34 = devolucion (never 4 - system re-entries)
                Sign: -1 = stock out, +1 = stock in
  goods       - product catalog (Code, Name, GroupID, Deleted)
  goodsgroups - product categories
  partners    - clients (Company)

Products are selected by NAME (PARRANDA / MALTA / GUAJIRA), not by goodsgroup:
some AxisPos databases store the category with a trailing newline ("PARRANDA\n")
and others leave products unassigned (GroupID=-1), so category filtering misses
rows. Name matching plus `parranda_sku_code` (which drops TONEL/PALLET and
anything that doesn't map to the 5 canonical SKUs) is robust across all DBs.

Note: literal % in LIKE patterns is written %% because pymysql treats the query
as a format string when parameters are passed.

Sales/client queries also require Sign=-1 explicitly: rare orphaned/glitched
terminal entries (OperType=2 but Sign=0, negative Acct, no real stock movement)
have been found in production data across every territory (e.g. holguinmoa
operations ID 348616 - 330 blisters dated 2026-07-14 - and habana ID 531170 -
2200 blisters dated 2026-07-28) and must not be counted as real sales.
"""
from __future__ import annotations

import logging
from datetime import date

import pymysql
import pymysql.cursors

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config

logger = logging.getLogger(__name__)

SALE_OPER_TYPES = (2, 9, 10)
RETURN_OPER_TYPES = (34,)

_NAME_FILTER = (
    "(UPPER(g.Name) LIKE '%%PARRANDA%%' "
    "OR UPPER(g.Name) LIKE '%%MALTA%%' "
    "OR UPPER(g.Name) LIKE '%%GUAJIRA%%')"
)

_SALES_QUERY = """
    SELECT
        DATE(o.Date)            AS fecha,
        g.Name                  AS sku_nombre,
        SUM(ABS(o.Qtty))        AS cantidad,
        ROUND(SUM(ABS(o.Qtty * o.PriceOut)), 2) AS importe_usd
    FROM operations o
    JOIN goods g ON o.GoodID = g.ID
    WHERE o.OperType IN ({placeholders})
      AND DATE(o.Date) BETWEEN %s AND %s
      AND g.Deleted = 0
      AND o.PriceOut > 0
      AND o.Sign = -1
      AND {name_filter}
    GROUP BY DATE(o.Date), g.Name
""".format(placeholders=",".join(["%s"] * len(SALE_OPER_TYPES)), name_filter=_NAME_FILTER)

_RETURNS_QUERY = """
    SELECT
        DATE(o.Date)            AS fecha,
        g.Name                  AS sku_nombre,
        SUM(o.Qtty)             AS cantidad,
        ROUND(SUM(o.Qtty * o.PriceOut), 2) AS importe_usd
    FROM operations o
    JOIN goods g ON o.GoodID = g.ID
    WHERE o.OperType IN ({placeholders})
      AND DATE(o.Date) BETWEEN %s AND %s
      AND g.Deleted = 0
      AND o.PriceOut > 0
      AND {name_filter}
    GROUP BY DATE(o.Date), g.Name
""".format(placeholders=",".join(["%s"] * len(RETURN_OPER_TYPES)), name_filter=_NAME_FILTER)

_CLIENT_QUERY = """
    SELECT
        DATE(o.Date)                       AS fecha,
        g.Name                             AS sku_nombre,
        o.PartnerID                        AS partner_id,
        COALESCE(p.Company, 'Desconocido') AS partner_nombre,
        o.Acct                             AS acct
    FROM operations o
    JOIN goods g ON o.GoodID = g.ID
    LEFT JOIN partners p ON o.PartnerID = p.ID
    WHERE o.OperType IN ({placeholders})
      AND DATE(o.Date) BETWEEN %s AND %s
      AND g.Deleted = 0
      AND o.PriceOut > 0
      AND o.Sign = -1
      AND {name_filter}
    GROUP BY DATE(o.Date), g.Name, o.PartnerID, p.Company, o.Acct
""".format(placeholders=",".join(["%s"] * len(SALE_OPER_TYPES)), name_filter=_NAME_FILTER)

# Invoice-level observaciones. AxisPos repeats the same Note on every line of an
# invoice, so grouping by Acct collapses it to one row per factura. Rows whose
# Note carries no "P-<folio>" are kept deliberately: they are the facturas the
# facturador never tagged, and separating those from genuinely unconverted
# pedidos is the whole point of the conversion analysis.
_OBSERVACION_QUERY = """
    SELECT
        DATE(o.Date)                       AS fecha,
        o.Acct                             AS acct,
        o.PartnerID                        AS partner_id,
        COALESCE(p.Company, 'Desconocido') AS partner_nombre,
        COALESCE(MAX(o.Note), '')          AS observacion,
        SUM(ABS(o.Qtty))                   AS cantidad,
        ROUND(SUM(ABS(o.Qtty * o.PriceOut)), 2) AS importe_usd
    FROM operations o
    JOIN goods g ON o.GoodID = g.ID
    LEFT JOIN partners p ON o.PartnerID = p.ID
    WHERE o.OperType IN ({placeholders})
      AND DATE(o.Date) BETWEEN %s AND %s
      AND g.Deleted = 0
      AND o.PriceOut > 0
      AND o.Sign = -1
      AND {name_filter}
    GROUP BY DATE(o.Date), o.Acct, o.PartnerID, p.Company
""".format(placeholders=",".join(["%s"] * len(SALE_OPER_TYPES)), name_filter=_NAME_FILTER)

_STOCK_QUERY_TEMPLATE = """
    SELECT
        g.Name                        AS sku_nombre,
        SUM(CASE
            WHEN DATE(op.Date) < %s THEN op.Qtty * op.Sign
            ELSE 0
        END)                          AS cantidad_inicial,
        SUM(op.Qtty * op.Sign)        AS cantidad_actual
    FROM operations op
    JOIN goods g       ON op.GoodID  = g.ID
    WHERE g.Deleted = 0
      AND DATE(op.Date) <= %s
      AND {name_filter}
      {fecha_min_clause}
    GROUP BY g.Name
    HAVING SUM(op.Qtty * op.Sign) > 0
"""


def _get_connection(db_name: str) -> pymysql.connections.Connection:
    settings = config.axispos_settings()
    return pymysql.connect(
        host=settings["axispos_host"],
        port=int(settings["axispos_port"]),
        user=settings["axispos_user"],
        password=settings["axispos_password"],
        database=db_name,
        connect_timeout=10,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def _apply_fecha_min(fecha_inicio: date, fecha_fin: date, fecha_min: date | None) -> tuple[date, date] | None:
    """
    Clamp fecha_inicio up to fecha_min (a territory's go-live date, e.g. the
    Moa/Palma Soriano cutover). Returns None if the clamped range is empty
    (fecha_fin is before fecha_min) - callers should skip the query entirely.
    """
    if fecha_min is None:
        return fecha_inicio, fecha_fin
    if fecha_fin < fecha_min:
        return None
    return max(fecha_inicio, fecha_min), fecha_fin


def _aggregate_by_sku(raw_rows: list[dict], territory_nombre: str) -> list[dict]:
    """
    Collapse per-product-name rows into per-canonical-SKU rows.
    Several AxisPos product names can map to the same SKU code; rows whose name
    doesn't map to one of the 5 SKUs (TONEL, PALLET, etc.) are dropped.
    """
    agg: dict[tuple, dict] = {}
    for row in raw_rows:
        codigo = config.parranda_sku_code(row["sku_nombre"])
        if codigo is None:
            continue
        key = (row["fecha"], codigo)
        if key not in agg:
            agg[key] = {
                "fecha": row["fecha"],
                "territorio": territory_nombre,
                "sku_codigo": codigo,
                "cantidad": 0,
                "importe_usd": 0.0,
            }
        agg[key]["cantidad"] += int(row["cantidad"] or 0)
        agg[key]["importe_usd"] += float(row["importe_usd"] or 0.0)
    return list(agg.values())


def extract_territory(territory_nombre: str, db_name: str,
                      fecha_inicio: date, fecha_fin: date,
                      fecha_min: date | None = None) -> list[dict]:
    """
    Aggregated Parranda sales rows (blisters) for one territory.

    fecha_min: optional hard floor date (Moa / Palma Soriano go-live cutover) -
    data before this date is never queried, to avoid double-counting sales
    already recorded under the parent branch's database.
    """
    clamped = _apply_fecha_min(fecha_inicio, fecha_fin, fecha_min)
    if clamped is None:
        return []
    fecha_inicio, fecha_fin = clamped

    logger.info("Extracting ventas %s (%s) %s..%s", territory_nombre, db_name, fecha_inicio, fecha_fin)
    conn = _get_connection(db_name)
    with conn:
        with conn.cursor() as cur:
            cur.execute(_SALES_QUERY, (*SALE_OPER_TYPES, fecha_inicio.isoformat(), fecha_fin.isoformat()))
            return _aggregate_by_sku(cur.fetchall(), territory_nombre)


def extract_returns_territory(territory_nombre: str, db_name: str,
                              fecha_inicio: date, fecha_fin: date,
                              fecha_min: date | None = None) -> list[dict]:
    """Aggregated Parranda devolucion rows (OperType 34) for one territory. fecha_min: see extract_territory()."""
    clamped = _apply_fecha_min(fecha_inicio, fecha_fin, fecha_min)
    if clamped is None:
        return []
    fecha_inicio, fecha_fin = clamped

    logger.info("Extracting devoluciones %s (%s) %s..%s", territory_nombre, db_name, fecha_inicio, fecha_fin)
    conn = _get_connection(db_name)
    with conn:
        with conn.cursor() as cur:
            cur.execute(_RETURNS_QUERY, (*RETURN_OPER_TYPES, fecha_inicio.isoformat(), fecha_fin.isoformat()))
            return _aggregate_by_sku(cur.fetchall(), territory_nombre)


def extract_clientes_territory(territory_nombre: str, db_name: str,
                               fecha_inicio: date, fecha_fin: date,
                               fecha_min: date | None = None) -> list[dict]:
    """Client-level Parranda sales rows for one territory. fecha_min: see extract_territory()."""
    clamped = _apply_fecha_min(fecha_inicio, fecha_fin, fecha_min)
    if clamped is None:
        return []
    fecha_inicio, fecha_fin = clamped

    logger.info("Extracting clientes %s (%s) %s..%s", territory_nombre, db_name, fecha_inicio, fecha_fin)
    rows: list[dict] = []
    seen: set[tuple] = set()
    conn = _get_connection(db_name)
    with conn:
        with conn.cursor() as cur:
            cur.execute(_CLIENT_QUERY, (*SALE_OPER_TYPES, fecha_inicio.isoformat(), fecha_fin.isoformat()))
            for row in cur.fetchall():
                codigo = config.parranda_sku_code(row["sku_nombre"])
                if codigo is None:
                    continue
                key = (row["fecha"], codigo, int(row["partner_id"] or 0), int(row["acct"] or 0))
                if key in seen:  # multiple product names map to the same SKU code
                    continue
                seen.add(key)
                rows.append({
                    "fecha": row["fecha"],
                    "territorio": territory_nombre,
                    "sku_codigo": codigo,
                    "partner_id": int(row["partner_id"] or 0),
                    "partner_nombre": (row["partner_nombre"] or "Desconocido").strip()[:500],
                    "acct": int(row["acct"] or 0),
                })
    return rows


def extract_observaciones_territory(territory_nombre: str, db_name: str,
                                    fecha_inicio: date, fecha_fin: date,
                                    fecha_min: date | None = None) -> list[dict]:
    """
    One row per AxisPos factura carrying Parranda lines, with its observacion and
    the pedido folio parsed out of it (None when nothing was pasted).

    fecha_min: see extract_territory().
    """
    clamped = _apply_fecha_min(fecha_inicio, fecha_fin, fecha_min)
    if clamped is None:
        return []
    fecha_inicio, fecha_fin = clamped

    logger.info("Extracting observaciones %s (%s) %s..%s", territory_nombre, db_name, fecha_inicio, fecha_fin)
    conn = _get_connection(db_name)
    with conn:
        with conn.cursor() as cur:
            cur.execute(_OBSERVACION_QUERY, (*SALE_OPER_TYPES, fecha_inicio.isoformat(), fecha_fin.isoformat()))
            return [
                {
                    "fecha": row["fecha"],
                    "territorio": territory_nombre,
                    "acct": int(row["acct"] or 0),
                    "partner_id": int(row["partner_id"] or 0),
                    "partner_nombre": (row["partner_nombre"] or "Desconocido").strip()[:500],
                    "observacion": (row["observacion"] or "").strip()[:1000],
                    "folio_extraido": config.extract_folio(row["observacion"]),
                    "cantidad": int(row["cantidad"] or 0),
                    "importe_usd": float(row["importe_usd"] or 0.0),
                }
                for row in cur.fetchall()
            ]


def extract_stock_territory(territory_nombre: str, db_name: str, fecha: date,
                            fecha_min: date | None = None) -> list[dict]:
    """
    Live Parranda stock snapshot (blisters) for one territory as of `fecha`.
    cantidad_inicial = balance at start of day; cantidad_actual = through end of day.

    fecha_min: optional hard floor date (Moa / Palma Soriano go-live cutover). Stock
    is cumulative with no natural date range, so without this floor a new branch's
    own database would re-count inventory movements already baked into its parent
    branch's cumulative stock total from before the cutover.
    """
    logger.info("Extracting stock %s (%s) as of %s (fecha_min=%s)", territory_nombre, db_name, fecha, fecha_min)
    if fecha_min is not None and fecha < fecha_min:
        return []

    agg: dict[str, dict] = {}
    conn = _get_connection(db_name)
    with conn:
        with conn.cursor() as cur:
            if fecha_min is not None:
                query = _STOCK_QUERY_TEMPLATE.format(
                    name_filter=_NAME_FILTER, fecha_min_clause="AND DATE(op.Date) >= %s"
                )
                params = (fecha.isoformat(), fecha.isoformat(), fecha_min.isoformat())
            else:
                query = _STOCK_QUERY_TEMPLATE.format(name_filter=_NAME_FILTER, fecha_min_clause="")
                params = (fecha.isoformat(), fecha.isoformat())
            cur.execute(query, params)
            for row in cur.fetchall():
                codigo = config.parranda_sku_code(row["sku_nombre"])
                if codigo is None:
                    continue
                if codigo not in agg:
                    agg[codigo] = {
                        "territorio": territory_nombre,
                        "sku_codigo": codigo,
                        "cantidad_inicial": 0.0,
                        "cantidad_actual": 0.0,
                    }
                agg[codigo]["cantidad_inicial"] += float(row["cantidad_inicial"] or 0.0)
                agg[codigo]["cantidad_actual"] += float(row["cantidad_actual"] or 0.0)
    return list(agg.values())
