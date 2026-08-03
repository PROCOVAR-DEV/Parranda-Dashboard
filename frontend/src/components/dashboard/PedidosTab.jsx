import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  PEDIDOS_TERRITORIES, PEDIDOS_METRIC_OPTIONS, PEDIDOS_UNIT_OPTIONS,
  PEDIDO_MOTIVO_LABELS, PEDIDO_MOTIVO_COLORS, PEDIDO_ESTADO_LABELS,
  SKU_BY_CODE, formatMetric,
} from "../../constants";
import SkuPills from "../shared/SkuPills";
import TableSkeleton from "../shared/TableSkeleton";

const SUBVIEWS = [
  { id: "resumen",    label: "Resumen" },
  { id: "fallos",     label: "Embudo y fallos" },
  { id: "conversion", label: "Conversión" },
  { id: "vendedores", label: "Vendedores" },
  { id: "domicilio",  label: "Domicilio" },
  { id: "leadtime",   label: "Lead time" },
];

const MOTIVOS = Object.keys(PEDIDO_MOTIVO_LABELS);

function fmtDate(iso) {
  if (!iso) return "";
  const p = iso.split("-");
  return `${p[2]}/${p[1]}`;
}

function pct(value) {
  return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`;
}

function num(value) {
  return Number(value || 0).toLocaleString("en-US");
}

/** Accent- and case-insensitive key for the vendedor search box. */
function norm(s) {
  return (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Green→red tint for a percentage, matching the Real vs Meta delta cells.
 * `invert` is for rates where high is bad (fugas): 0% then reads green and 100%
 * red, and the "leave a genuine zero untinted" rule no longer applies.
 */
function rateTint(rate, { invert = false } = {}) {
  if (rate === null || rate === undefined) return {};
  const good = invert ? 100 - rate : rate;
  if (good >= 75) return { backgroundColor: "#DCFCE7", color: "#166534" };
  if (good >= 50) return { backgroundColor: "#FEF9C3", color: "#854D0E" };
  if (invert || good > 0) return { backgroundColor: "#FFE4E6", color: "#9F1239" };
  return {};
}

/** Segmented button group — the metric and unit toggles share this markup. */
function Segmented({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <div className="flex rounded border border-gray-300 overflow-hidden">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1 text-xs transition-colors ${
              value === o.value
                ? "bg-navy text-white font-semibold"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone = "default" }) {
  const tones = {
    default: "bg-white border-gray-200 text-gray-800",
    navy: "bg-navy border-navy text-white",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <p className={`text-[11px] uppercase tracking-wider ${tone === "navy" ? "opacity-75" : "text-gray-400"}`}>
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      {hint && (
        <p className={`text-[11px] mt-0.5 ${tone === "navy" ? "opacity-75" : "text-gray-400"}`}>{hint}</p>
      )}
    </div>
  );
}

const TH = "px-3 py-2 font-semibold";
const TD = "px-3 py-1.5 text-right font-mono tabular-nums";
const TFOOT_ROW = "bg-gray-50 border-t-2 border-gray-300 font-semibold text-gray-800";

/** Clickable column header. The arrow greys out on the columns that are not active. */
function SortableTh({ label, sortKey, sort, onSort, align = "right" }) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={`Ordenar por ${label}`}
      className={`${align === "left" ? "text-left" : "text-right"} ${TH}
        cursor-pointer select-none whitespace-nowrap hover:text-navy transition-colors`}
    >
      {label}
      <span className={`ml-1 text-[9px] ${active ? "text-navy" : "text-gray-300"}`}>
        {active && sort.dir === "asc" ? "▲" : "▼"}
      </span>
    </th>
  );
}

export default function PedidosTab({
  kpis, embudo, estados, motivos, porDia, porTerritorio, fugasPorTerritorio,
  porDomicilio, porVendedor, porSku, leadtime,
  loading, territorios, precision, activeSkus, onSkuToggle, onSkuReset,
}) {
  const [subview, setSubview] = useState("resumen");
  const [metric, setMetric] = useState("pedidos");
  // One reading mode for the whole tab: counts or HL volume.
  const [unit, setUnit] = useState("pedidos");
  const [vendedorSucursal, setVendedorSucursal] = useState("");
  const [vendedorQuery, setVendedorQuery] = useState("");
  // Sort keys are logical, not column names, so the order survives the unit
  // toggle: "volumen" means pedidos or HL depending on it.
  const [vendedorSort, setVendedorSort] = useState({ key: "volumen", dir: "desc" });

  const visibleTerritories = useMemo(
    () =>
      territorios.length === 0
        ? PEDIDOS_TERRITORIES
        : PEDIDOS_TERRITORIES.filter((t) => territorios.includes(t)),
    [territorios]
  );
  const visibleSet = useMemo(() => new Set(visibleTerritories), [visibleTerritories]);

  const esHl = unit === "hl";
  /** Render a count or its HL equivalent, following the unit toggle. */
  const unitCell = (count, hl) => (esHl ? formatMetric(hl, "hl", precision) : num(count));
  /** null — not 0% — when there is nothing to convert, so empty rows read as "—". */
  const unitRate = (r) => {
    const whole = esHl ? r.hl : r.pedidos;
    if (!whole) return null;
    return esHl ? r.tasa_conversion_hl : r.tasa_conversion;
  };
  const rate = (part, whole) => (whole ? (100 * part) / whole : null);
  const dias = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)} d`);

  // sucursal × día matrix, with per-row, per-day and grand totals. Totals are
  // built from the same rows the table renders, so the TOTAL line always adds up
  // to what is on screen.
  const { dates, cells, rowTotals, colTotals, grandTotal } = useMemo(() => {
    const dateSet = new Set();
    const map = {};
    const rows = {};
    const cols = {};
    const grand = { pedidos: 0, convertidos: 0, hl: 0 };
    porDia.forEach((r) => {
      if (!visibleSet.has(r.territorio)) return;
      dateSet.add(r.fecha);
      map[`${r.territorio}|${r.fecha}`] = r;
      const row = (rows[r.territorio] ||= { pedidos: 0, convertidos: 0, hl: 0 });
      const col = (cols[r.fecha] ||= { pedidos: 0, convertidos: 0, hl: 0 });
      [row, col, grand].forEach((acc) => {
        acc.pedidos += r.pedidos;
        acc.convertidos += r.convertidos;
        acc.hl += r.hl;
      });
    });
    return {
      dates: [...dateSet].sort(),
      cells: map,
      rowTotals: rows,
      colTotals: cols,
      grandTotal: grand,
    };
  }, [porDia, visibleSet]);

  // Column totals for the conversión/cobertura table.
  const terTotals = useMemo(() => {
    const acc = {
      pedidos: 0, convertidos: 0, hl: 0, hl_convertido: 0,
      facturas: 0, facturas_con_codigo: 0,
    };
    porTerritorio.forEach((r) => {
      Object.keys(acc).forEach((k) => { acc[k] += r[k] || 0; });
    });
    return acc;
  }, [porTerritorio]);

  const fugaTotals = useMemo(() => {
    const acc = { pedidos: 0, no_convertidos: 0, hl_no_convertido: 0 };
    MOTIVOS.forEach((m) => { acc[m] = 0; });
    fugasPorTerritorio.forEach((r) => {
      Object.keys(acc).forEach((k) => { acc[k] += r[k] || 0; });
    });
    return acc;
  }, [fugasPorTerritorio]);

  // A sucursal filter left over from a wider territory selection must not silently
  // empty the table — treat it as cleared once it is no longer selectable.
  const sucursalFilter = visibleSet.has(vendedorSucursal) ? vendedorSucursal : "";

  const vendedorRows = useMemo(() => {
    const q = norm(vendedorQuery.trim());
    let rows = porVendedor.filter((r) => visibleSet.has(r.territorio));
    if (sucursalFilter) rows = rows.filter((r) => r.territorio === sucursalFilter);
    if (q) rows = rows.filter((r) => norm(r.vendedor).includes(q));

    const { key, dir } = vendedorSort;
    const mult = dir === "asc" ? 1 : -1;
    const sortValue = (r) => {
      if (key === "vendedor") return r.vendedor;
      if (key === "territorio") return r.territorio;
      if (key === "volumen") return esHl ? r.hl : r.pedidos;
      if (key === "convertidos") return esHl ? r.hl_convertido : r.convertidos;
      return unitRate(r) ?? -1; // "tasa" — rows with nothing to convert sort last
    };
    return [...rows].sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      const cmp =
        typeof va === "string" ? va.localeCompare(vb, "es") : va - vb;
      // Stable secondary key so equal values keep a predictable order.
      return cmp ? mult * cmp : a.vendedor.localeCompare(b.vendedor, "es");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [porVendedor, visibleSet, sucursalFilter, vendedorQuery, esHl, vendedorSort]);

  const TEXT_SORT_KEYS = ["vendedor", "territorio"];
  /** Same column toggles direction; a new column starts desc for numbers, asc for text. */
  const onVendedorSort = (key) =>
    setVendedorSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: TEXT_SORT_KEYS.includes(key) ? "asc" : "desc" }
    );

  const vendedorTotals = useMemo(() => {
    const acc = { pedidos: 0, convertidos: 0, hl: 0, hl_convertido: 0 };
    vendedorRows.forEach((r) => {
      Object.keys(acc).forEach((k) => { acc[k] += r[k] || 0; });
    });
    return acc;
  }, [vendedorRows]);

  const domTotals = useMemo(() => {
    const acc = {
      pedidos: 0, convertidos: 0, hl: 0, hl_convertido: 0,
      dom_pedidos: 0, dom_convertidos: 0, dom_hl: 0, dom_hl_convertido: 0,
    };
    porDomicilio.forEach((r) => {
      Object.keys(acc).forEach((k) => { acc[k] += r[k] || 0; });
    });
    return acc;
  }, [porDomicilio]);

  const cellValue = (row) => {
    if (!row) return null;
    if (metric === "pedidos") return row.pedidos;
    if (metric === "convertidos") return row.convertidos;
    if (metric === "hl") return row.hl;
    return row.pedidos ? (100 * row.convertidos) / row.pedidos : null;
  };

  const renderCell = (row) => {
    const v = cellValue(row);
    if (v === null || v === undefined) return "—";
    if (metric === "conversion") return pct(v);
    if (metric === "hl") return formatMetric(v, "hl", precision);
    return num(v);
  };

  // Totals reuse the cell renderers: a "total" is just a cell over summed values,
  // which makes the % Conversión total weighted (Σconvertidos ÷ Σpedidos) for free.
  const renderTotal = (t) => renderCell(t ?? null);

  if (loading) {
    return <div className="px-4 pt-1"><TableSkeleton message="Cargando pedidos..." /></div>;
  }

  if (!kpis || kpis.total_pedidos === 0) {
    return (
      <div className="text-center text-gray-400 py-16 text-sm">
        Sin pedidos para el período seleccionado.
      </div>
    );
  }

  const cobertura = kpis.cobertura_codigo;
  const coberturaBaja = cobertura < 80;

  return (
    <div className="px-4 pb-6 space-y-5 pt-1">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 justify-between">
        <nav className="flex gap-1">
          {SUBVIEWS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSubview(s.id)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                subview === s.id
                  ? "bg-navy text-white font-semibold"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <SkuPills activeSkus={activeSkus} onToggle={onSkuToggle} onReset={onSkuReset} />
      </div>

      {/* KPIs — always visible: they frame every other number on the tab */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi tone="navy" label="Pedidos levantados" value={num(kpis.total_pedidos)}
             hint={`${formatMetric(kpis.hl_pedidos, "hl", precision)} HL pedidos`} />
        <Kpi label="Convertidos a factura" value={num(kpis.pedidos_convertidos)}
             hint={`${formatMetric(kpis.hl_facturados, "hl", precision)} HL facturados`} />
        <Kpi label="Tasa de conversión" value={pct(kpis.tasa_conversion)}
             hint={`${pct(kpis.tasa_conversion_hl)} en HL · fill rate ${pct(kpis.fill_rate)}`} />
        <Kpi tone={coberturaBaja ? "warn" : "default"} label="Cobertura del código"
             value={pct(cobertura)}
             hint={`${num(kpis.facturas_sin_codigo)} facturas sin código`} />
        <Kpi label="Completados sin factura" value={num(kpis.completados_sin_factura)}
             hint="procesados pero nunca facturados" />
        <Kpi label="Facturados sin completar" value={num(kpis.facturados_sin_completar)}
             hint="facturados con el pedido abierto" />
      </div>

      {coberturaBaja && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Atención:</span> solo el {pct(cobertura)} de las facturas
          llevan el código del pedido en la observación. La tasa de conversión real es{" "}
          <span className="font-semibold">al menos</span> la mostrada — donde no se pega el código,
          un pedido facturado se ve como no convertido. Revisar primero el procedimiento de
          facturación en los territorios con cobertura baja.
        </div>
      )}

      {/* ── Resumen: sucursal × día ─────────────────────────────────────────── */}
      {subview === "resumen" && (
        <>
          <Segmented
            label="Métrica:"
            options={PEDIDOS_METRIC_OPTIONS}
            value={metric}
            onChange={setMetric}
          />

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h3 className="text-sm font-semibold text-navy px-4 py-3 border-b border-gray-200">
              Pedidos por sucursal y día
            </h3>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10">
                      Sucursal
                    </th>
                    {dates.map((d) => (
                      <th key={d} className="px-2 py-2 font-semibold text-gray-500 text-right whitespace-nowrap">
                        {fmtDate(d)}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-semibold text-gray-700 text-right bg-gray-100">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTerritories.map((t) => (
                    <tr key={t} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap sticky left-0 bg-white">
                        {t}
                      </td>
                      {dates.map((d) => {
                        const row = cells[`${t}|${d}`];
                        return (
                          <td
                            key={d}
                            className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-600"
                            style={metric === "conversion" ? rateTint(cellValue(row)) : undefined}
                          >
                            {renderCell(row)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-gray-800 bg-gray-50">
                        {renderTotal(rowTotals[t])}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Daily totals. For % Conversión this is the weighted rate
                    (Σconvertidos ÷ Σpedidos), not the mean of the sucursal rates. */}
                <tfoot>
                  <tr className={TFOOT_ROW}>
                    <td className="px-3 py-2 whitespace-nowrap sticky left-0 bg-gray-50 z-10">Total</td>
                    {dates.map((d) => (
                      <td
                        key={d}
                        className="px-2 py-2 text-right font-mono tabular-nums"
                        style={metric === "conversion" ? rateTint(cellValue(colTotals[d] ?? null)) : undefined}
                      >
                        {renderTotal(colTotals[d])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-mono tabular-nums bg-gray-100">
                      {renderTotal(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Per-territory conversion vs code coverage — the two must be read together */}
          <Segmented
            label="Unidad:"
            options={PEDIDOS_UNIT_OPTIONS}
            value={unit}
            onChange={setUnit}
          />

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h3 className="text-sm font-semibold text-navy px-4 py-3 border-b border-gray-200">
              Conversión y cobertura del código por sucursal
            </h3>
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                  <th className={`text-left ${TH}`}>Sucursal</th>
                  <th className={`text-right ${TH}`}>{esHl ? "HL pedidos" : "Pedidos"}</th>
                  <th className={`text-right ${TH}`}>{esHl ? "HL convertidos" : "Convertidos"}</th>
                  <th className={`text-right ${TH}`}>% Conversión</th>
                  <th className={`text-right ${TH}`}>Facturas</th>
                  <th className={`text-right ${TH}`}>Con código</th>
                  <th className={`text-right ${TH}`}>Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {porTerritorio.map((r) => (
                  <tr key={r.territorio} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium text-gray-700">{r.territorio}</td>
                    <td className={TD}>{unitCell(r.pedidos, r.hl)}</td>
                    <td className={TD}>{unitCell(r.convertidos, r.hl_convertido)}</td>
                    <td className={TD} style={rateTint(unitRate(r))}>{pct(unitRate(r))}</td>
                    <td className={`${TD} text-gray-500`}>{num(r.facturas)}</td>
                    <td className={`${TD} text-gray-500`}>{num(r.facturas_con_codigo)}</td>
                    <td className={TD} style={rateTint(r.cobertura_codigo)}>
                      {pct(r.cobertura_codigo)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TFOOT_ROW}>
                  <td className="px-3 py-2">Total</td>
                  <td className={TD}>{unitCell(terTotals.pedidos, terTotals.hl)}</td>
                  <td className={TD}>{unitCell(terTotals.convertidos, terTotals.hl_convertido)}</td>
                  <td
                    className={TD}
                    style={rateTint(
                      esHl
                        ? rate(terTotals.hl_convertido, terTotals.hl)
                        : rate(terTotals.convertidos, terTotals.pedidos)
                    )}
                  >
                    {pct(
                      esHl
                        ? rate(terTotals.hl_convertido, terTotals.hl)
                        : rate(terTotals.convertidos, terTotals.pedidos)
                    )}
                  </td>
                  <td className={TD}>{num(terTotals.facturas)}</td>
                  <td className={TD}>{num(terTotals.facturas_con_codigo)}</td>
                  <td
                    className={TD}
                    style={rateTint(rate(terTotals.facturas_con_codigo, terTotals.facturas))}
                  >
                    {pct(rate(terTotals.facturas_con_codigo, terTotals.facturas))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* ── Embudo y fallos ─────────────────────────────────────────────────── */}
      {subview === "fallos" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-navy mb-3">Embudo</h3>
              <div className="space-y-2">
                {embudo.map((e) => {
                  const base = embudo[0]?.pedidos || 1;
                  const width = Math.max(2, (100 * e.pedidos) / base);
                  return (
                    <div key={e.etapa}>
                      <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                        <span className="font-medium">{e.etapa}</span>
                        <span className="font-mono tabular-nums">
                          {num(e.pedidos)} · {pct((100 * e.pedidos) / base)}
                        </span>
                      </div>
                      <div className="h-6 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full bg-navy rounded" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                «Atendidos» = completados en el sistema o facturados en AxisPos. Los dos criterios
                no coinciden en ambos sentidos, por eso se muestran por separado arriba.
              </p>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-navy mb-3">Motivos de no conversión</h3>
              {motivos.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">Sin fallos en el período</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={motivos} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="motivo"
                      width={140}
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                      tickFormatter={(m) => PEDIDO_MOTIVO_LABELS[m] ?? m}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(v) => [num(v), "Pedidos"]}
                      labelFormatter={(m) => PEDIDO_MOTIVO_LABELS[m] ?? m}
                    />
                    <Bar dataKey="pedidos" radius={[0, 4, 4, 0]}>
                      {motivos.map((m) => (
                        <Cell key={m.motivo} fill={PEDIDO_MOTIVO_COLORS[m.motivo] ?? "#94A3B8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Where the leakage concentrates, by sucursal and motivo */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h3 className="text-sm font-semibold text-navy px-4 py-3 border-b border-gray-200">
              Fugas por sucursal
            </h3>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <th className={`text-left ${TH}`}>Sucursal</th>
                    <th className={`text-right ${TH}`}>Pedidos</th>
                    <th className={`text-right ${TH}`}>No convertidos</th>
                    <th className={`text-right ${TH}`}>% del total</th>
                    {MOTIVOS.map((m) => (
                      <th key={m} className={`text-right ${TH} whitespace-nowrap`}>
                        {PEDIDO_MOTIVO_LABELS[m]}
                      </th>
                    ))}
                    <th className={`text-right ${TH} whitespace-nowrap`}>HL no convertido</th>
                  </tr>
                </thead>
                <tbody>
                  {fugasPorTerritorio.map((r) => (
                    <tr key={r.territorio} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">
                        {r.territorio}
                      </td>
                      <td className={`${TD} text-gray-500`}>{num(r.pedidos)}</td>
                      <td className={TD}>{num(r.no_convertidos)}</td>
                      <td className={TD} style={rateTint(r.tasa_fuga, { invert: true })}>
                        {pct(r.tasa_fuga)}
                      </td>
                      {MOTIVOS.map((m) => (
                        <td key={m} className={`${TD} text-gray-600`}>{num(r[m])}</td>
                      ))}
                      <td className={TD}>{formatMetric(r.hl_no_convertido, "hl", precision)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={TFOOT_ROW}>
                    <td className="px-3 py-2">Total</td>
                    <td className={TD}>{num(fugaTotals.pedidos)}</td>
                    <td className={TD}>{num(fugaTotals.no_convertidos)}</td>
                    <td
                      className={TD}
                      style={rateTint(rate(fugaTotals.no_convertidos, fugaTotals.pedidos), { invert: true })}
                    >
                      {pct(rate(fugaTotals.no_convertidos, fugaTotals.pedidos))}
                    </td>
                    {MOTIVOS.map((m) => (
                      <td key={m} className={TD}>{num(fugaTotals[m])}</td>
                    ))}
                    <td className={TD}>
                      {formatMetric(fugaTotals.hl_no_convertido, "hl", precision)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[11px] text-gray-400 px-4 py-2.5 border-t border-gray-100 leading-relaxed">
              «{PEDIDO_MOTIVO_LABELS.en_proceso_vigente}» todavía está dentro del plazo de 72 h:
              cuenta como no convertido hoy, pero no es una pérdida. La fuga accionable son las
              otras tres columnas.
            </p>
          </div>
        </>
      )}

      {/* ── Conversión por SKU ──────────────────────────────────────────────── */}
      {subview === "conversion" && (
        <>
          <Segmented
            label="Unidad:"
            options={PEDIDOS_UNIT_OPTIONS}
            value={unit}
            onChange={setUnit}
          />
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h3 className="text-sm font-semibold text-navy px-4 py-3 border-b border-gray-200">
              Conversión por SKU
            </h3>
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                  <th className={`text-left ${TH}`}>SKU</th>
                  <th className={`text-right ${TH}`}>{esHl ? "HL pedidos" : "Pedidos"}</th>
                  <th className={`text-right ${TH}`}>{esHl ? "HL convertidos" : "Convertidos"}</th>
                  <th className={`text-right ${TH}`}>% Conversión</th>
                </tr>
              </thead>
              <tbody>
                {porSku.map((r) => (
                  <tr key={r.sku} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium text-gray-700">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: SKU_BY_CODE[r.sku]?.color }}
                        />
                        {SKU_BY_CODE[r.sku]?.label ?? r.sku}
                      </span>
                    </td>
                    <td className={TD}>{unitCell(r.pedidos, r.hl)}</td>
                    <td className={TD}>{unitCell(r.convertidos, r.hl_convertido)}</td>
                    <td className={TD} style={rateTint(unitRate(r))}>{pct(unitRate(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-gray-400 px-4 py-2.5 border-t border-gray-100 leading-relaxed">
              Un SKU con muchos pedidos y conversión baja suele indicar quiebre de stock: contrastar
              con la pestaña Stock para la sucursal y fecha correspondientes. Sin total: un pedido
              se cuenta una vez por cada SKU que contiene, así que la columna no suma al total de
              pedidos.
            </p>
          </div>
        </>
      )}

      {/* ── Vendedores ──────────────────────────────────────────────────────── */}
      {subview === "vendedores" && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Sucursal:</span>
              <select
                value={sucursalFilter}
                onChange={(e) => setVendedorSucursal(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-700"
              >
                <option value="">Todas</option>
                {visibleTerritories.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <input
              type="search"
              value={vendedorQuery}
              onChange={(e) => setVendedorQuery(e.target.value)}
              placeholder="Buscar vendedor..."
              className="text-xs border border-gray-300 rounded px-2.5 py-1 w-56 text-gray-700 placeholder-gray-400"
            />
            <Segmented
              label="Unidad:"
              options={PEDIDOS_UNIT_OPTIONS}
              value={unit}
              onChange={setUnit}
            />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-navy">Conversión por vendedor</h3>
              <span className="text-[11px] text-gray-400">
                {vendedorRows.length} vendedor{vendedorRows.length === 1 ? "" : "es"}
              </span>
            </div>
            {vendedorRows.length === 0 ? (
              <div className="text-center text-gray-400 py-10 text-sm">
                Ningún vendedor coincide con el filtro.
              </div>
            ) : (
              <table className="text-xs w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <SortableTh label="Vendedor" sortKey="vendedor" align="left"
                                sort={vendedorSort} onSort={onVendedorSort} />
                    <SortableTh label="Sucursal" sortKey="territorio" align="left"
                                sort={vendedorSort} onSort={onVendedorSort} />
                    <SortableTh label={esHl ? "HL pedidos" : "Pedidos"} sortKey="volumen"
                                sort={vendedorSort} onSort={onVendedorSort} />
                    <SortableTh label={esHl ? "HL convertidos" : "Convertidos"} sortKey="convertidos"
                                sort={vendedorSort} onSort={onVendedorSort} />
                    <SortableTh label="% Conversión" sortKey="tasa"
                                sort={vendedorSort} onSort={onVendedorSort} />
                  </tr>
                </thead>
                <tbody>
                  {vendedorRows.map((r) => (
                    <tr
                      key={`${r.territorio}|${r.vendedor}`}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-3 py-1.5 text-gray-700 max-w-[260px] truncate" title={r.vendedor}>
                        {r.vendedor}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{r.territorio}</td>
                      <td className={TD}>{unitCell(r.pedidos, r.hl)}</td>
                      <td className={TD}>{unitCell(r.convertidos, r.hl_convertido)}</td>
                      <td className={TD} style={rateTint(unitRate(r))}>{pct(unitRate(r))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={TFOOT_ROW}>
                    <td className="px-3 py-2" colSpan={2}>Total</td>
                    <td className={TD}>{unitCell(vendedorTotals.pedidos, vendedorTotals.hl)}</td>
                    <td className={TD}>
                      {unitCell(vendedorTotals.convertidos, vendedorTotals.hl_convertido)}
                    </td>
                    <td
                      className={TD}
                      style={rateTint(
                        esHl
                          ? rate(vendedorTotals.hl_convertido, vendedorTotals.hl)
                          : rate(vendedorTotals.convertidos, vendedorTotals.pedidos)
                      )}
                    >
                      {pct(
                        esHl
                          ? rate(vendedorTotals.hl_convertido, vendedorTotals.hl)
                          : rate(vendedorTotals.convertidos, vendedorTotals.pedidos)
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
            <p className="text-[11px] text-gray-400 px-4 py-2.5 border-t border-gray-100 leading-relaxed">
              Los nombres de vendedor son locales a cada sucursal: nunca se agrupan entre
              territorios. Leer la conversión junto con la cobertura del código de su sucursal.
            </p>
          </div>
        </>
      )}

      {/* ── Domicilio ───────────────────────────────────────────────────────── */}
      {subview === "domicilio" && (
        <>
          <Segmented
            label="Unidad:"
            options={PEDIDOS_UNIT_OPTIONS}
            value={unit}
            onChange={setUnit}
          />

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi tone="navy" label="Pedidos con domicilio" value={num(kpis.pedidos_domicilio)}
                 hint={`${pct(kpis.tasa_domicilio)} del total`} />
            <Kpi label="HL con domicilio"
                 value={formatMetric(kpis.hl_domicilio, "hl", precision)}
                 hint={`de ${formatMetric(kpis.hl_pedidos, "hl", precision)} HL pedidos`} />
            <Kpi label="Conversión con domicilio"
                 value={pct(esHl ? kpis.tasa_conversion_hl_domicilio : kpis.tasa_conversion_domicilio)}
                 hint={esHl ? "ponderada por HL" : "sobre el conteo de pedidos"} />
            <Kpi label="Conversión sin domicilio"
                 value={pct(esHl ? kpis.tasa_conversion_hl_sin_domicilio : kpis.tasa_conversion_sin_domicilio)}
                 hint={esHl ? "ponderada por HL" : "sobre el conteo de pedidos"} />
            <Kpi label="Lead time con domicilio"
                 value={dias(kpis.leadtime_promedio_domicilio)}
                 hint="días hasta la primera factura" />
            <Kpi label="Lead time sin domicilio"
                 value={dias(kpis.leadtime_promedio_sin_domicilio)}
                 hint="días hasta la primera factura" />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <h3 className="text-sm font-semibold text-navy px-4 py-3 border-b border-gray-200">
              Domicilio por sucursal
            </h3>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <th className={`text-left ${TH}`}>Sucursal</th>
                    <th className={`text-right ${TH}`}>{esHl ? "HL pedidos" : "Pedidos"}</th>
                    <th className={`text-right ${TH} whitespace-nowrap`}>Con domicilio</th>
                    <th className={`text-right ${TH} whitespace-nowrap`}>% Domicilio</th>
                    <th className={`text-right ${TH} whitespace-nowrap`}>% Conv. con domicilio</th>
                    <th className={`text-right ${TH} whitespace-nowrap`}>% Conv. sin domicilio</th>
                  </tr>
                </thead>
                <tbody>
                  {porDomicilio.map((r) => {
                    // "Sin domicilio" is derived by subtraction so the two halves
                    // can never disagree with the row total.
                    const tot = esHl ? r.hl : r.pedidos;
                    const dom = esHl ? r.dom_hl : r.dom_pedidos;
                    const totConv = esHl ? r.hl_convertido : r.convertidos;
                    const domConv = esHl ? r.dom_hl_convertido : r.dom_convertidos;
                    return (
                      <tr key={r.territorio} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">
                          {r.territorio}
                        </td>
                        <td className={`${TD} text-gray-500`}>{unitCell(r.pedidos, r.hl)}</td>
                        <td className={TD}>{unitCell(r.dom_pedidos, r.dom_hl)}</td>
                        <td className={TD}>{pct(rate(dom, tot))}</td>
                        <td className={TD} style={rateTint(rate(domConv, dom))}>
                          {pct(rate(domConv, dom))}
                        </td>
                        <td className={TD} style={rateTint(rate(totConv - domConv, tot - dom))}>
                          {pct(rate(totConv - domConv, tot - dom))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const tot = esHl ? domTotals.hl : domTotals.pedidos;
                    const dom = esHl ? domTotals.dom_hl : domTotals.dom_pedidos;
                    const totConv = esHl ? domTotals.hl_convertido : domTotals.convertidos;
                    const domConv = esHl ? domTotals.dom_hl_convertido : domTotals.dom_convertidos;
                    return (
                      <tr className={TFOOT_ROW}>
                        <td className="px-3 py-2">Total</td>
                        <td className={TD}>{unitCell(domTotals.pedidos, domTotals.hl)}</td>
                        <td className={TD}>{unitCell(domTotals.dom_pedidos, domTotals.dom_hl)}</td>
                        <td className={TD}>{pct(rate(dom, tot))}</td>
                        <td className={TD} style={rateTint(rate(domConv, dom))}>
                          {pct(rate(domConv, dom))}
                        </td>
                        <td className={TD} style={rateTint(rate(totConv - domConv, tot - dom))}>
                          {pct(rate(totConv - domConv, tot - dom))}
                        </td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-navy mb-1">
              Peso del domicilio por sucursal
            </h3>
            <p className="text-[11px] text-gray-400 mb-3">
              Porcentaje {esHl ? "del volumen en HL" : "de los pedidos"} que requiere entrega a
              domicilio. Moa y Palma Soriano no tienen sucursal en el Sistema de Pedidos, por eso
              no aparecen.
            </p>
            {porDomicilio.length === 0 ? (
              <div className="text-center text-gray-400 py-10 text-sm">Sin pedidos en el período.</div>
            ) : (
              <ResponsiveContainer width="100%" height={40 + porDomicilio.length * 28}>
                <BarChart
                  data={porDomicilio.map((r) => ({
                    territorio: r.territorio,
                    tasa: rate(esHl ? r.dom_hl : r.dom_pedidos, esHl ? r.hl : r.pedidos) ?? 0,
                  }))}
                  layout="vertical"
                  margin={{ left: 8, right: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#6B7280" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="territorio"
                    width={130}
                    tick={{ fontSize: 11, fill: "#6B7280" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip formatter={(v) => [pct(v), "% domicilio"]} />
                  <Bar dataKey="tasa" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}

      {/* ── Lead time ───────────────────────────────────────────────────────── */}
      {subview === "leadtime" && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-navy mb-1">
            Días entre el pedido y su primera factura
          </h3>
          <p className="text-[11px] text-gray-400 mb-3">
            Solo pedidos convertidos. AxisPos registra la fecha de la factura sin hora, por eso el
            lead time se mide en días: 0 = facturado el mismo día. El plazo de expiración del
            pedido es de 72 horas (3 días).
          </p>
          {leadtime.length === 0 ? (
            <div className="text-center text-gray-400 py-10 text-sm">Sin pedidos convertidos.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={leadtime} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis
                  dataKey="dias"
                  tick={{ fontSize: 11, fill: "#6B7280" }}
                  tickLine={false}
                  axisLine={{ stroke: "#E5E7EB" }}
                  label={{ value: "Días", position: "insideBottom", offset: -2, fontSize: 11, fill: "#9CA3AF" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v) => [num(v), "Pedidos"]}
                  labelFormatter={(d) => (d === 0 ? "Mismo día" : `${d} día${d === 1 ? "" : "s"}`)}
                />
                <Bar dataKey="pedidos" radius={[4, 4, 0, 0]}>
                  {leadtime.map((d) => (
                    <Cell key={d.dias} fill={d.dias <= 3 ? "#10B981" : "#F43F5E"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Estado distribution — footer context on every subview */}
      {estados.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <span className="font-medium text-gray-600">Estado en el Sistema de Pedidos:</span>
          {estados.map((e) => (
            <span key={e.estado}>
              {PEDIDO_ESTADO_LABELS[e.estado] ?? e.estado}:{" "}
              <span className="font-mono tabular-nums text-gray-700">{num(e.pedidos)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
