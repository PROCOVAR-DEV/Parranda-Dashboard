import { useCallback, useState } from "react";
import { PieChart, Pie, Cell } from "recharts";
import { TERRITORIES, SKUS, SKU_BY_CODE } from "../../constants";
import TableSkeleton from "../shared/TableSkeleton";

const DEPTH_COLORS = ["#EF4444", "#F59E0B", "#EAB308", "#84CC16", "#10B981"];

export default function PortafolioTab({ distribucion, kpis, combinaciones, penetracion, loading, territorios }) {
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const onSliceEnter = useCallback((_, index) => setHoveredSlice(index), []);
  const onSliceLeave = useCallback(() => setHoveredSlice(null), []);

  const visibleTerritories =
    territorios.length === 0 ? TERRITORIES : TERRITORIES.filter((t) => territorios.includes(t));

  if (loading) return <div className="px-4 pt-1"><TableSkeleton message="Cargando datos de portafolio..." /></div>;

  const total = kpis?.total_clientes ?? 0;
  if (!total) {
    return (
      <div className="text-center text-gray-400 py-16 text-sm">
        Sin datos de portafolio para el período seleccionado.
      </div>
    );
  }

  const donutData = distribucion
    .filter((d) => d.total > 0)
    .map((d) => ({
      name: `${d.depth} SKU${d.depth > 1 ? "s" : ""}`,
      value: d.total,
      color: DEPTH_COLORS[d.depth - 1],
    }));

  return (
    <div className="px-4 pb-6 space-y-5 pt-1">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-navy text-white rounded-lg p-4">
          <p className="text-[11px] uppercase tracking-wider opacity-75">Clientes con compras</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{total.toLocaleString()}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-[11px] uppercase tracking-wider text-gray-400">Promedio SKUs / cliente</p>
          <p className="text-2xl font-bold tabular-nums mt-1 text-gray-800">{kpis.promedio_skus}</p>
          <p className="text-[11px] text-gray-400">de {SKUS.length} posibles</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-[11px] uppercase tracking-wider text-gray-400">Portafolio completo</p>
          <p className="text-2xl font-bold tabular-nums mt-1 text-emerald-600">{kpis.pct_full_portfolio}%</p>
          <p className="text-[11px] text-gray-400">compran los 5 SKUs</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-[11px] uppercase tracking-wider text-gray-400">Mono-SKU</p>
          <p className="text-2xl font-bold tabular-nums mt-1 text-red-500">{kpis.pct_single_sku}%</p>
          <p className="text-[11px] text-gray-400">compran solo 1 SKU</p>
        </div>
      </div>

      {/* Distribution table + donut */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-2.5 font-semibold min-w-[140px]">Profundidad</th>
                {visibleTerritories.map((t) => (
                  <th key={t} className="text-right px-3 py-2.5 font-semibold whitespace-nowrap text-xs">
                    {t}
                  </th>
                ))}
                <th className="text-right px-3 py-2.5 font-semibold bg-navy-dark">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {distribucion.map((d, idx) => (
                <tr key={d.depth} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: DEPTH_COLORS[d.depth - 1] }}
                      />
                      <span className="text-gray-800">
                        {d.depth} SKU{d.depth > 1 ? "s" : ""}
                      </span>
                    </div>
                  </td>
                  {visibleTerritories.map((t) => (
                    <td key={t} className="text-right px-3 py-2 tabular-nums text-gray-700">
                      {(d.por_territorio[t] ?? 0) || "—"}
                    </td>
                  ))}
                  <td className="text-right px-3 py-2 tabular-nums font-semibold text-gray-800 bg-amber-50">
                    {d.total.toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr className="bg-[#FFF2CC] font-semibold">
                <td className="px-4 py-2 text-gray-800">TOTAL CLIENTES</td>
                {visibleTerritories.map((t) => (
                  <td key={t} className="text-right px-3 py-2 tabular-nums text-gray-800">
                    {distribucion
                      .reduce((s, d) => s + (d.por_territorio[t] ?? 0), 0)
                      .toLocaleString()}
                  </td>
                ))}
                <td className="text-right px-3 py-2 tabular-nums text-gray-800 bg-[#FFE57A]">
                  {total.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Depth donut */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-navy mb-3">Diversidad de Portafolio</h3>
          <div className="flex flex-col items-center">
            <div className="relative" style={{ width: 160, height: 160 }}>
              <PieChart width={160} height={160}>
                <Pie
                  data={donutData}
                  cx={80}
                  cy={80}
                  innerRadius={50}
                  outerRadius={72}
                  dataKey="value"
                  paddingAngle={2}
                  strokeWidth={0}
                  onMouseEnter={onSliceEnter}
                  onMouseLeave={onSliceLeave}
                >
                  {donutData.map((entry, i) => (
                    <Cell
                      key={entry.name}
                      fill={entry.color}
                      opacity={hoveredSlice === null || hoveredSlice === i ? 1 : 0.4}
                    />
                  ))}
                </Pie>
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {hoveredSlice !== null && donutData[hoveredSlice] ? (
                  <>
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color: donutData[hoveredSlice].color }}
                    >
                      {donutData[hoveredSlice].name}
                    </span>
                    <span className="text-sm font-bold text-gray-800">
                      {donutData[hoveredSlice].value.toLocaleString()}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {((donutData[hoveredSlice].value / total) * 100).toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[11px] text-gray-400">Clientes</span>
                    <span className="text-base font-bold text-gray-800">{total.toLocaleString()}</span>
                  </>
                )}
              </div>
            </div>
            <div className="mt-3 space-y-1.5 w-full">
              {donutData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: d.color }}
                    />
                    <span className="text-gray-600">{d.name}</span>
                  </div>
                  <span className="text-gray-500 tabular-nums">
                    {((d.value / total) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Penetration + top combos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-navy mb-3">Penetración por SKU</h3>
          <p className="text-[11px] text-gray-400 mb-3">% de clientes que compran cada SKU</p>
          <div className="space-y-2.5">
            {penetracion.map((p) => {
              const sku = SKU_BY_CODE[p.sku_codigo];
              return (
                <div key={p.sku_codigo}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600">{sku?.label ?? p.sku_codigo}</span>
                    <span className="text-gray-500 tabular-nums">
                      {p.clientes.toLocaleString()} · {p.pct}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${p.pct}%`, backgroundColor: sku?.color ?? "#6B7280" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-navy mb-3">Combinaciones más Frecuentes</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wider">
                <th className="text-left pb-2 font-semibold">Combinación</th>
                <th className="text-right pb-2 font-semibold">Clientes</th>
                <th className="text-right pb-2 font-semibold">%</th>
              </tr>
            </thead>
            <tbody>
              {combinaciones.map((c, idx) => (
                <tr key={idx} className="border-t border-gray-100">
                  <td className="py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {c.skus.map((code) => {
                        const sku = SKU_BY_CODE[code];
                        return (
                          <span
                            key={code}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                            style={{ backgroundColor: sku?.color ?? "#6B7280" }}
                          >
                            {sku?.label ?? code}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="text-right tabular-nums text-gray-700">{c.clientes.toLocaleString()}</td>
                  <td className="text-right tabular-nums text-gray-500">
                    {((c.clientes / total) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
