import { useMemo } from "react";
import { SKUS, SKU_BY_CODE, UNITS_PER_BLISTER, VENTAS_METRIC_OPTIONS, PRECISION_OPTIONS } from "../../constants";
import LoadingSpinner from "../shared/LoadingSpinner";

/**
 * Real vs Meta — replica of the "Meta vs Real HL" Excel layout, with visual
 * grouping: META section (top, gray) / REAL section / STOCK divider row /
 * RESULTADO section where delta CELLS (not just numbers) are tinted green/red.
 *
 * API returns everything in HL; converted per the selected metric:
 *   blister = HL ÷ hlFactor    unidades = blister × 6
 */

const ROWS = [
  { key: "meta_total",         label: "Meta Total" },
  { key: "meta_acumulada",     label: "Meta Acumulada" },
  { key: "venta_acumulada",    label: "Venta Acumulada" },
  { key: "ultimo_crecimiento", label: "Último Crecimiento" },
  { key: "stock",              label: "Stock" },
  { key: "delta_acumulada",    label: "Delta Acumulada", delta: true },
  { key: "delta_pct",          label: "Delta Acumulada en %", pct: true, delta: true },
  { key: "pct_total",          label: "% del Total", pct: true },
];

/** Per-row styling: row classes, label classes, and neutral cell classes. */
const ROW_STYLE = {
  meta_total: {
    row: "bg-gray-100 border-b border-gray-200",
    label: "font-bold text-gray-900",
    cell: "font-bold text-gray-900",
  },
  meta_acumulada: {
    row: "bg-gray-50 border-b-2 border-gray-300",
    label: "text-gray-500",
    cell: "text-gray-500",
  },
  venta_acumulada: {
    row: "bg-white",
    label: "font-semibold text-gray-900",
    cell: "font-semibold text-gray-900",
  },
  ultimo_crecimiento: {
    row: "bg-white",
    label: "text-gray-500",
    cell: "text-gray-600",
  },
  stock: {
    row: "bg-slate-100 border-t-2 border-b-2 border-slate-300",
    label: "font-medium text-slate-700",
    cell: "font-medium text-slate-700",
  },
  delta_acumulada: {
    row: "bg-white border-t-2 border-gray-300",
    label: "font-semibold text-gray-700",
    cell: "",
  },
  delta_pct: {
    row: "bg-white",
    label: "font-semibold text-gray-700",
    cell: "",
  },
  pct_total: {
    row: "bg-sky-50/60 border-t border-sky-100",
    label: "font-semibold text-sky-900",
    cell: "font-semibold text-sky-900",
  },
};

function deltaCellClass(v, isTotal = false) {
  if (v === null || v === undefined) return isTotal ? "bg-amber-50 text-gray-400" : "text-gray-400";
  return v >= 0
    ? "bg-emerald-50 text-emerald-700 font-semibold"
    : "bg-red-50 text-red-600 font-semibold";
}

function convertHL(valueHL, skuCodigo, metric) {
  if (metric === "hl") return valueHL;
  const factor = SKU_BY_CODE[skuCodigo]?.hlFactor ?? 1;
  const blisters = valueHL / factor;
  return metric === "unidades" ? blisters * UNITS_PER_BLISTER : blisters;
}

function fmtValue(v, metric, isPct, precision) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (isPct) return `${(v * 100).toFixed(1)}%`;
  if (precision === "exacto") {
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return Math.round(v).toLocaleString("en-US");
}

function computeBlock(skuValues, diasTotales, diasTranscurridos, metric) {
  const cols = {};
  SKUS.forEach((s) => {
    const raw = skuValues[s.codigo] ?? {};
    const meta_total = convertHL(raw.meta_total ?? 0, s.codigo, metric);
    const venta_acumulada = convertHL(raw.venta_acumulada ?? 0, s.codigo, metric);
    const ultimo_crecimiento = convertHL(raw.ultimo_crecimiento ?? 0, s.codigo, metric);
    const stock = convertHL(raw.stock ?? 0, s.codigo, metric);
    const meta_acumulada = diasTotales > 0 ? (meta_total / diasTotales) * diasTranscurridos : 0;
    const delta_acumulada = venta_acumulada - meta_acumulada;
    cols[s.codigo] = {
      meta_total,
      meta_acumulada,
      venta_acumulada,
      ultimo_crecimiento,
      stock,
      delta_acumulada,
      delta_pct: meta_acumulada !== 0 ? delta_acumulada / meta_acumulada : null,
      pct_total: meta_total !== 0 ? venta_acumulada / meta_total : null,
    };
  });

  const total = {};
  ["meta_total", "meta_acumulada", "venta_acumulada", "ultimo_crecimiento", "stock", "delta_acumulada"].forEach(
    (k) => {
      total[k] = SKUS.reduce((s, sku) => s + (cols[sku.codigo][k] ?? 0), 0);
    }
  );
  total.delta_pct = total.meta_acumulada !== 0 ? total.delta_acumulada / total.meta_acumulada : null;
  total.pct_total = total.meta_total !== 0 ? total.venta_acumulada / total.meta_total : null;
  return { cols, total };
}

function Block({ title, skuValues, diasTotales, diasTranscurridos, metric, precision, highlight }) {
  const { cols, total } = useMemo(
    () => computeBlock(skuValues, diasTotales, diasTranscurridos, metric),
    [skuValues, diasTotales, diasTranscurridos, metric]
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto shadow-sm">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className={highlight ? "bg-navy-dark text-white" : "bg-navy text-white"}>
            <th className="text-left px-4 py-2.5 font-semibold min-w-[180px]">{title}</th>
            {SKUS.map((s) => (
              <th key={s.codigo} className="text-right px-3 py-2.5 font-semibold text-xs whitespace-nowrap">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ backgroundColor: s.color }}
                />
                {s.codigo}
              </th>
            ))}
            <th className="text-right px-3 py-2.5 font-semibold bg-black/20">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const style = ROW_STYLE[row.key];
            return (
              <tr key={row.key} className={style.row}>
                <td className={`px-4 py-1.5 ${style.label}`}>{row.label}</td>
                {SKUS.map((s) => {
                  const v = cols[s.codigo][row.key];
                  const cls = row.delta ? deltaCellClass(v) : style.cell;
                  return (
                    <td key={s.codigo} className={`text-right px-3 py-1.5 tabular-nums ${cls}`}>
                      {fmtValue(v, metric, row.pct, precision)}
                    </td>
                  );
                })}
                {(() => {
                  const v = total[row.key];
                  const cls = row.delta
                    ? deltaCellClass(v, true)
                    : `bg-amber-50 font-semibold ${style.cell || "text-gray-800"}`;
                  return (
                    <td className={`text-right px-3 py-1.5 tabular-nums ${cls}`}>
                      {fmtValue(v, metric, row.pct, precision)}
                    </td>
                  );
                })()}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function MetaRealTab({
  meta, territorios, loading, mes, onMes, metric, onMetric, precision, onPrecision,
}) {
  // Resumen = element-wise sum of all territory HL values, computed before conversion.
  const resumen = useMemo(() => {
    const sum = {};
    SKUS.forEach((s) => {
      sum[s.codigo] = { meta_total: 0, venta_acumulada: 0, ultimo_crecimiento: 0, stock: 0 };
    });
    territorios.forEach((t) => {
      SKUS.forEach((s) => {
        const v = t.skus[s.codigo] ?? {};
        sum[s.codigo].meta_total += v.meta_total ?? 0;
        sum[s.codigo].venta_acumulada += v.venta_acumulada ?? 0;
        sum[s.codigo].ultimo_crecimiento += v.ultimo_crecimiento ?? 0;
        sum[s.codigo].stock += v.stock ?? 0;
      });
    });
    return sum;
  }, [territorios]);

  const diasTotales = meta?.dias_totales ?? 0;
  const diasTranscurridos = meta?.dias_transcurridos ?? 0;

  return (
    <div className="px-4 pb-6 space-y-5 pt-1">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 bg-white rounded-lg border border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Mes</label>
          <input
            type="month"
            value={mes}
            onChange={(e) => onMes(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
          />
        </div>
        <div className="flex rounded border border-gray-300 overflow-hidden">
          {VENTAS_METRIC_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => onMetric(o.value)}
              className={`text-xs py-1.5 px-4 transition-colors ${
                metric === o.value
                  ? "bg-navy text-white font-semibold"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex rounded border border-gray-300 overflow-hidden">
          {PRECISION_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => onPrecision(o.value)}
              className={`text-xs py-1.5 px-4 transition-colors ${
                precision === o.value
                  ? "bg-navy text-white font-semibold"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {meta && (
          <div className="text-xs text-gray-500 ml-auto">
            Días laborales: <span className="font-semibold text-gray-700">{diasTranscurridos}</span> de{" "}
            <span className="font-semibold text-gray-700">{diasTotales}</span>
            <span className="mx-2 text-gray-300">|</span>
            Último crecimiento: <span className="font-semibold text-gray-700">{meta.fecha_ultimo_crecimiento}</span>
          </div>
        )}
      </div>

      {meta?.stock_fallidos?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded px-4 py-2.5">
          Stock no disponible para: {meta.stock_fallidos.join(", ")}
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <Block
            title="RESUMEN"
            skuValues={resumen}
            diasTotales={diasTotales}
            diasTranscurridos={diasTranscurridos}
            metric={metric}
            precision={precision}
            highlight
          />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {territorios.map((t) => (
              <Block
                key={t.territorio}
                title={t.territorio}
                skuValues={t.skus}
                diasTotales={diasTotales}
                diasTranscurridos={diasTranscurridos}
                metric={metric}
                precision={precision}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
