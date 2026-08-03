# CLAUDE.md — Procovar - Parranda Dashboard

> Always read this file before making any changes.

## 1. Project Overview

Standalone sales-intelligence dashboard for the **5 Parranda/Malta SKUs only**, with
**user authentication** (JWT, roles admin/viewer), monthly **metas** (targets), and
client-portfolio analytics. Derived from the reference project at
`C:\Users\User-15\Desktop\AxisControl\procovar-dashboard` but fully independent.
Designed so a future VPS migration only requires changing connection settings.

**Run:**
```
# Backend (port 5051) — from backend/
venv\Scripts\python.exe app.py
# Frontend (port 5175) — from frontend/
npm run dev
```
First backend run seeds territories, SKUs, and an `admin` user (password printed once).

## 2. Data Sources

- **PostgreSQL** `localhost:5432/parranda` (postgres / 0612) — ventas, devoluciones,
  ventas_cliente, users, metas. Override with `DATABASE_URL` env var.
- **AxisPos MySQL** (source): settings live in `backend/config.py` defaults +
  `backend/config.json` runtime overrides (editable from Admin → Datos).
  Current host `192.168.1.3`, user/pass root/root.

### Territories (canonical order — Bayamo/granma EXCLUDED everywhere)
Havana→habana, Sancti Spíritus→sspiritus, Camagüey→camaguey, Las Tunas→tunas,
Holguín→holguinmoa, Moa→moa, Santiago de Cuba→santiago, Palma Soriano→palmasoriano,
Guantánamo→guantanamo.

**Moa / Palma Soriano cutover:** both went live as independent AxisPos installs on
2026-07-15. Before that date their sales were entered into the parent branch's
database (Palma → `santiago`, Moa → `holguinmoa`), so that historical data is
already counted under Santiago/Holguín. `config.TERRITORY_DB_MAP` carries a
`fecha_min` key for these two entries; `etl/extract.py` clamps every query
(ventas, devoluciones, clientes, stock) to never go earlier than that date for
them. Never remove `fecha_min` or backfill data before 2026-07-15 for Moa/Palma
Soriano — doing so double-counts sales already baked into Santiago's/Holguín's
totals.

### Sistema de Pedidos (pedidos.procovar.cloud)
Source for the **Pedidos** tab. REST API, header `x-api-key`; URL + key live in
`config.json` (Admin → Datos) or `PEDIDOS_API_URL` / `PEDIDOS_API_KEY` env vars.
The URL must include the **`/api` suffix** — the bare host serves the web frontend
and returns HTML with HTTP 200, which would fail as a confusing JSON parse error.

**Migrated from `pedidos.marketplacecuba.com` on 2026-08-03** (same API key). The
old host still answers but received no pedidos after 2026-07-31. Sucursal ids
(cuids) are identical on both hosts. Pedido ids match for all but a handful of
2026-07-31 folios created during the cutover — those few arrive under a new
`pedido_ext_id` and, because the upsert keys on it, land as a second row
alongside the original. See §3.16.
**The key must be issued by a Super Admin account** (Panel → Configuración → API
Keys) — keys inherit their creator's identity, and one without a sucursal gets
`"No hay sucursal disponible"` on every endpoint and cannot use `sucursalId=all`.

Only `GET /orders` is used (it embeds `items`; `/reports/*` does not). Its date
params are `fechaDesde` / `fechaHasta` — `/reports/*` uses `fechaInicio` / `fechaFin`.
Estados: `en_proceso` · `completada` · `expirada`.

**8 sucursales, mapped in `config.PEDIDOS_SUCURSAL_MAP`:** HAB, SS, CAM, TUN, HOL,
STG, GTO. `GR` (Granma/Bayamo) is deliberately unmapped and its pedidos dropped.
**Moa and Palma Soriano have no sucursal in the pedidos system** — they will always
show zero pedidos. That is correct, not a bug.

**Product names differ from AxisPos**: pedidos use `PARRANDA 1.5L` / `0.5L` /
`0.33L`, `MALTA GUAJIRA 1.5L` / `0.33L`. `classify_parranda_sku()` maps **none** of
them, so pedidos have their own explicit table `config.PEDIDOS_SKU_NAMES` /
`pedidos_sku_code()`. Keep it an explicit table — the catalog also carries
non-Parranda goods like `REFRESCO SANTA LEMON 330ML CAJA 24U` that a loose "330"
substring rule would wrongly claim.

**Units**: a pedido line has `unidades` (bottles) and `packs` (blisters).
`packs` is the AxisPos-comparable figure — verified 2026-07, every Parranda line
has `unidades/packs == 6`, while non-Parranda lines use 10/12/24/72. Never compare
`unidades` to AxisPos `cantidad`.

### SKUs (fixed catalog of 5; TONEL & PALLET always excluded)
| Código | HL/blister | Notes |
|---|---|---|
| P1500 | 0.09 | Cerveza Parranda 1500ml Blister 6u |
| P500 | 0.03 | Cerveza Parranda 500ml |
| P330 | 0.0198 | Cerveza Parranda 330ml |
| M1500 | 0.09 | Malta Guajira 1500ml |
| M330 | 0.0198 | Malta Guajira 330ml |

`cantidad` is always **blisters**. Unidades = blisters × 6. HL = blisters × factor.
Factors live in `backend/config.py` (PARRANDA_SKUS) and `frontend/src/constants.js`
(SKUS) — keep in sync.

## 3. Critical Business Rules

1. Sales = OperType IN (2,9,10), `PriceOut > 0`, `Deleted = 0`, `Sign = -1`, ABS(Qtty).
   `Sign = -1` excludes rare orphaned/glitched terminal entries found in every
   territory (OperType=2 but Sign=0, negative Acct, no real stock movement —
   e.g. holguinmoa operations ID 348616, 330 blisters that were never a real
   sale). Without this filter these ghost rows inflate totals; this is the
   root cause of a Parranda-vs-AxisControl HL discrepancy found 2026-07-31.
2. Devoluciones = OperType 34 only. NEVER OperType 4 (system cancellations).
3. Ventas shown are always NET (ventas − devoluciones).
4. **ETL selects products by NAME** (`LIKE '%%PARRANDA%%' / '%%MALTA%%' / '%%GUAJIRA%%'`),
   NOT by goodsgroup — some DBs (e.g. sspiritus) store the category with a trailing
   `\n` that MySQL `TRIM()` doesn't strip. Mapping to canonical codes happens in
   Python via `config.parranda_sku_code()` (drops TONEL/PALLET).
5. pymysql: literal `%` in SQL must be written `%%` when params are passed.
6. Stock is NEVER stored in PostgreSQL — always queried live from MySQL
   (`SUM(Qtty*Sign)`, no OperType/PriceOut filter), parallel threads, 15s timeout.
7. `partner_id` is local per territory DB — never dedupe clients across territories;
   totals = sum of per-territory DISTINCT counts.
8. Refresh never deletes — upserts only (`ON CONFLICT DO UPDATE` / `DO NOTHING`).
   Caveat: `ventas_cliente` uses `DO NOTHING` keyed on (fecha, territory_id,
   sku_id, partner_id, acct), so if a row was already inserted and a later ETL
   fix makes that exact row no longer extracted (e.g. the Sign=-1 ghost-row
   filter above), the stale row is NOT auto-corrected — there's no new row to
   conflict with. A source-data correction that changes which rows get
   extracted requires manually deleting the specific stale `ventas_cliente`
   rows once (identify by fecha/territory/acct), then re-running refresh.
   `ventas`/`devoluciones` don't have this problem — they're `DO UPDATE`,
   keyed at (fecha, territory_id, sku_id) aggregate level, so a corrected
   extraction naturally overwrites the old total.
9. Metas are stored in **HL**; UI converts to blister (÷factor) and unidades (×6).
10. Real vs Meta días laborales = Mon–Fri auto-computed; admin can override the
    monthly total (Admin → Metas). Transcurridos counts through *yesterday*.
11. "Último Crecimiento" = net sales of yesterday (current month) or the last day
    of the month (past months).
12. Moa and Palma Soriano never count data before 2026-07-15 (their AxisPos
    go-live date) in any tab, including Stock — see §2 cutover note.
13. **Pedido → factura conversion.** The Sistema de Pedidos copies
    `P-<folio>; V-<vendedor>; C-<cliente>;` to the clipboard and the facturador
    pastes it into AxisPos `operations.Note` (the "observación"). A pedido counts
    as *convertido* when its folio appears in any factura's observación.
    Matching ignores territory on purpose: it makes the Moa/Palma cutover work
    (their old facturas live in `santiago`/`holguinmoa`) and reveals pedidos
    billed from another sucursal. Note is repeated on every line of an invoice,
    so `facturas_observacion` groups by `Acct`.
14. **Never read the conversion rate without `cobertura_codigo`.** Pasting the
    code is manual and adoption varies enormously (measured 2026-07: Camagüey
    99%, Las Tunas 89%, Holguín 68%, Guantánamo 52%, Havana 29%, Sancti Spíritus
    33%, **Palma Soriano 0%**). An untagged factura is indistinguishable from a
    pedido that never converted, so a low conversion rate in a low-cobertura
    territory is a data-entry problem, not a sales problem. Both numbers are
    returned together and the UI warns when cobertura < 80%.
15. Pedidos `estado` and AxisPos reality disagree in **both** directions — some
    pedidos are facturados while still `en_proceso` (and 167 of July's `expirada`
    pedidos were facturados anyway), while others are `completada` with no
    factura. The embudo therefore uses "Atendidos" (completada ∪ facturado) so
    stages can only shrink; the two mismatches are reported as their own KPIs.
16. **Pedidos host migration (2026-08-03) leaves July needing a reconciliation.**
    The new host carries a fuller July than the old one (4 802 vs 3 956 folios
    for 20–31 Jul): re-running a July refresh ADDS the ~1 100 folios that were
    missing. Two artefacts survive it, because refresh never deletes:
    (a) ~256 folios that exist only on the old host — already in Postgres, never
    re-extracted, so they stay forever; (b) 4 folios from 31 Jul whose
    `pedido_ext_id` changed at cutover, which land as a second row next to the
    original and are counted twice. Both need a one-off manual DELETE keyed on
    the stale `pedido_ext_id` — do not "fix" this by making refresh delete.

## 4. Backend Layout (Flask 3 + SQLAlchemy 2)

```
backend/
├── app.py          # entrypoint; engine, seed_database(), create_app()
├── config.py       # ALL connection settings, territory map, SKU catalog
├── config.json     # runtime AxisPos overrides (written by Admin UI)
├── models.py       # Territory, SKU, Venta, Devolucion, VentaCliente, RefreshLog,
│                   # User, Meta, MetaMonthConfig,
│                   # Pedido, PedidoItem, FacturaObservacion
├── auth.py         # /api/auth/login, /api/auth/me, admin_required decorator
├── etl/extract.py  # AxisPos MySQL queries (5: ventas/returns/clientes/stock/
│                   #                          observaciones)
├── etl/pedidos_extract.py  # Sistema de Pedidos REST API (GET /orders)
├── etl/load.py     # PostgreSQL upserts
└── routes/         # ventas, stock, clientes, portafolio, pedidos, meta, users,
                    # refresh
```

`refresh` runs the 9 territory MySQL extractions and then the pedidos API pull;
a pedidos failure is reported as its own pseudo-territory ("Pedidos") so the
AxisPos data is not marked failed alongside it.

`GET /api/pedidos` is the Pedidos tab's ONLY endpoint — a single query pass builds
every breakdown (`por_dia`, `por_territorio`, `fugas_por_territorio`,
`por_domicilio`, `por_vendedor`, `por_sku`, `leadtime`). The three territory keys
are projections of one accumulator, so they can never disagree. `por_vendedor` is
returned uncapped (a few dozen rows) because the Vendedores sub-tab filters and
searches it client-side. `Pedido.requiere_domicilio` — a flag from the Sistema de
Pedidos, already extracted and stored — feeds the Domicilio sub-view.

Every endpoint requires JWT; admin-only: users CRUD, metas CRUD, server config.
ETL refresh + status are open to ALL users (header "Actualizar" button).
`users.allowed_tabs` (comma-separated, NULL = all) restricts which tabs a viewer
sees; admins always see everything. Managed from Admin → Usuarios (chips).
JWT secret is generated once into `backend/.jwt_secret` (or `JWT_SECRET_KEY` env).

## 5. Frontend Layout (React 18 + Vite + Tailwind 3 + Recharts)

```
frontend/src/
├── App.jsx                 # login gate + header tabs + per-tab state
├── constants.js            # territories, SKUs, metric conversion, date helpers
├── api.js                  # axios + JWT interceptor (token in localStorage)
├── context/AuthContext.jsx
├── hooks/                  # useApiQuery (debounced base) + per-tab hooks
├── components/
│   ├── controls/FilterPanel.jsx     # dates, metric toggle, territory checkboxes
│   ├── shared/SkuPills.jsx          # SKU selector (see behavior below)
│   └── dashboard/                   # VentasTab, StockTab, ClientesTab,
│                                    # PortafolioTab, MetaRealTab
└── pages/LoginPage.jsx, AdminPage.jsx
```

**SKU pill behavior** (`SkuPills.jsx` — intentional, differs from reference project):
default all 5 selected → clicking one selects ONLY it → further clicks add/remove →
empty or full selection returns to "all".

**Tabs:** Ventas (HL/Blister/Unidades) · Stock (Cantidad/HL, live, single date) ·
Clientes (interactive territory cards + compras analytics + top clientes) ·
Portafolio (SKU-depth analytics) · **Pedidos** (6 sub-views: Resumen with the
sucursal×día matrix and conversión/cobertura table, both with totals rows ·
Embudo y fallos with the motivos chart and the Fugas-por-sucursal table ·
Conversión by SKU · Vendedores with sucursal filter + name search · Domicilio ·
Lead time in days) · Real vs Meta (Excel replica: Meta Total /
Meta Acumulada / Venta Acumulada / Último Crecimiento / Stock / Delta / Delta % /
% del Total — Resumen + 9 territory blocks; delta CELLS tinted green/red) · Admin.

**Pedidos unidad toggle** (Pedidos/HL): one `unit` state shared by the Resumen
cobertura table, Conversión, Vendedores and Domicilio. In HL mode the conversion
percentage is volume-weighted (`hl_convertido / hl`), so an unconverted large
pedido weighs more than a small one. `hl_convertido` is the un-prorated HL of the
pedidos that converted — deliberately NOT `meta.hl_facturados`, which is prorated
by what the factura actually carried and is only used for the KPI card.

**Precision toggle** (Enteros/Exacto): shared `precision` state in App.jsx —
default "enteros" (rounded); "exacto" = 2 decimals. Controls in FilterPanel
(Ventas/Stock) and in the Real vs Meta controls bar. "compras" in Clientes =
COUNT(DISTINCT fecha+partner): all purchases by a client in one day count as 1.

The Real vs Meta layout mirrors `Documents\HL Meta\2026\<Mes> Meta vs Real HL.xlsx`.

## 6. Conventions

- Python: PEP8, type hints. React: functional components + hooks only.
- No hardcoded territories/SKUs — use `config.py` / `constants.js`.
- Dates ISO `YYYY-MM-DD`; formatted only at the UI layer.
- React hook deps: serialize arrays (`territorios.join(",")`), never object literals.
- All UI text in Spanish.

## 7. VPS Migration (planned)

Local-only today. To migrate: move PostgreSQL + backend + built frontend to the VPS,
point `config.json` / `DATABASE_URL` at the right hosts, serve the frontend build via
nginx, and either VPN-tunnel to AxisPos MySQL or run the ETL from a machine inside
the local network pushing to the VPS database. Auth is already in place.
