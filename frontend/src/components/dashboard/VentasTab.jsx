import { useMemo, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { TERRITORIES, SKUS, SKU_BY_CODE, convertMetric, formatMetric } from "../../constants";
import SkuPills, { effectiveSkuSet, toggleSkuSelection } from "../shared/SkuPills";
import TableSkeleton from "../shared/TableSkeleton";

function fmtDate(iso) {
  if (!iso) return "";
  const parts = iso.split("-");
  return `${parts[2]}/${parts[1]}`;
}

const METRIC_SUFFIX = { hl: "HL", blister: "blisters", unidades: "unidades" };

function BarTooltipContent({ active, payload, label, metric, precision }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[170px]">
      <p className="font-semibold text-gray-700 mb-1.5">{fmtDate(label)}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.fill }} />
            <span className="text-gray-600">{SKU_BY_CODE[p.dataKey]?.label ?? p.dataKey}</span>
          </div>
          <span className="font-mono text-gray-700">{formatMetric(p.value, metric, precision)}</span>
        </div>
      ))}
      <div className="flex justify-between mt-1.5 pt-1.5 border-t border-gray-100 font-semibold text-gray-700">
        <span>Total</span>
        <span className="font-mono">
          {formatMetric(total, metric, precision)} {METRIC_SUFFIX[metric]}
        </span>
      </div>
    </div>
  );
}

export default function VentasTab({ territoryRows, dailyRows, loading, metric, territorios, precision }) {
  const [activeSkus, setActiveSkus] = useState(null);
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const onSliceEnter = useCallback((_, index) => setHoveredSlice(index), []);
  const onSliceLeave = useCallback(() => setHoveredSlice(null), []);

  const effective = effectiveSkuSet(activeSkus);
  const activeSkuList = SKUS.filter((s) => effective.has(s.codigo));

  const visibleTerritories =
    territorios.length === 0 ? TERRITORIES : TERRITORIES.filter((t) => territorios.includes(t));

  // Daily chart: pivot by date, one key per SKU, converted to the active metric
  const dailyChartData = useMemo(() => {
    const byDate = {};
    dailyRows.forEach((r) => {
      if (!effective.has(r.sku_codigo)) return;
      if (!byDate[r.fecha]) byDate[r.fecha] = { fecha: r.fecha };
      byDate[r.fecha][r.sku_codigo] =
        (byDate[r.fecha][r.sku_codigo] || 0) + convertMetric(r.cantidad, r.sku_codigo, metric);
    });
    return Object.values(byDate).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [dailyRows, effective, metric]);

  // Donut: metric total per SKU
  const donutData = useMemo(() => {
    const totals = {};
    territoryRows.forEach((r) => {
      if (!effective.has(r.sku_codigo)) return;
      totals[r.sku_codigo] = (totals[r.sku_codigo] || 0) + convertMetric(r.cantidad, r.sku_codigo, metric);
    });
    return activeSkuList
      .filter((s) => totals[s.codigo] > 0)
      .map((s) => ({ ...s, value: totals[s.codigo] }));
  }, [territoryRows, effective, metric, activeSkuList]);

  const totalMetric = useMemo(() => donutData.reduce((s, d) => s + d.value, 0), [donutData]);

  // Territory pivot
  const pivot = useMemo(() => {
    const lookup = {};
    const skuTotals = {};
    const terTotals = {};
    let grandTotal = 0;
    territoryRows.forEach((r) => {
      if (!effective.has(r.sku_codigo)) return;
      const v = convertMetric(r.cantidad, r.sku_codigo, metric);
      if (!lookup[r.sku_codigo]) lookup[r.sku_codigo] = {};
      lookup[r.sku_codigo][r.territorio] = (lookup[r.sku_codigo][r.territorio] || 0) + v;
      skuTotals[r.sku_codigo] = (skuTotals[r.sku_codigo] || 0) + v;
      terTotals[r.territorio] = (terTotals[r.territorio] || 0) + v;
      grandTotal += v;
    });
    return { lookup, skuTotals, terTotals, grandTotal };
  }, [territoryRows, effective, metric]);

  const hasData = territoryRows.length > 0 || dailyRows.length > 0;
  const suffix = METRIC_SUFFIX[metric];

  return (
    <div className="px-4 pb-6 space-y-5">
      <div className="pt-1">
        <SkuPills
          activeSkus={activeSkus}
          onToggle={(codigo) => setActiveSkus((prev) => toggleSkuSelection(prev, codigo))}
          onReset={() => setActiveSkus(null)}
        />
      </div>

      {loading ? (
        <TableSkeleton message="Cargando datos de ventas..." />
      ) : !hasData ? (
        <div className="text-center text-gray-400 py-16 text-sm">
          Sin datos de ventas para el período seleccionado.
        </div>
      ) : (
        <>
          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Daily stacked bar — 2/3 width */}
            <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-navy mb-3">Ventas por Día ({suffix})</h3>
              {dailyChartData.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">Sin datos</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dailyChartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis
                      dataKey="fecha"
                      tickFormatter={fmtDate}
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                      tickLine={false}
                      axisLine={{ stroke: "#E5E7EB" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatMetric(v, metric, precision)}
                      width={56}
                    />
                    <Tooltip
                      content={(props) => (
                        <BarTooltipContent {...props} metric={metric} precision={precision} />
                      )}
                    />
                    {activeSkuList.map((sku) => (
                      <Bar key={sku.codigo} dataKey={sku.codigo} stackId="a" fill={sku.color} radius={0} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* SKU mix donut — 1/3 width */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-navy mb-3">Mix de SKU</h3>
              {donutData.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">Sin datos</div>
              ) : (
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
                            key={entry.codigo}
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
                            className="text-[11px] font-semibold leading-tight"
                            style={{ color: donutData[hoveredSlice].color }}
                          >
                            {donutData[hoveredSlice].label}
                          </span>
                          <span className="text-sm font-bold text-gray-800 leading-tight mt-0.5">
                            {formatMetric(donutData[hoveredSlice].value, metric, precision)}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            {totalMetric > 0
                              ? ((donutData[hoveredSlice].value / totalMetric) * 100).toFixed(1)
                              : "0.0"}%
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-[11px] text-gray-400">Total</span>
                          <span className="text-base font-bold text-gray-800 leading-tight">
                            {formatMetric(totalMetric, metric, precision)}
                          </span>
                          <span className="text-[11px] text-gray-400">{suffix}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5 w-full">
                    {donutData.map((d) => (
                      <div key={d.codigo} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: d.color }}
                          />
                          <span className="text-gray-600">{d.label}</span>
                        </div>
                        <span className="text-gray-500 tabular-nums">
                          {totalMetric > 0 ? ((d.value / totalMetric) * 100).toFixed(1) : "0.0"}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pivot table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-2.5 font-semibold sticky left-0 bg-navy z-10 min-w-[200px]">
                    SKU
                  </th>
                  {visibleTerritories.map((t) => (
                    <th key={t} className="text-right px-3 py-2.5 font-semibold whitespace-nowrap text-xs">
                      {t}
                    </th>
                  ))}
                  <th className="text-right px-3 py-2.5 font-semibold bg-navy-dark whitespace-nowrap">
                    TOTAL
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-[#FFF2CC] font-semibold">
                  <td className="px-4 py-2 sticky left-0 bg-[#FFF2CC] z-10 text-gray-800">
                    TOTAL ({suffix.toUpperCase()})
                  </td>
                  {visibleTerritories.map((t) => (
                    <td key={t} className="text-right px-3 py-2 tabular-nums text-gray-800">
                      {formatMetric(pivot.terTotals[t], metric, precision)}
                    </td>
                  ))}
                  <td className="text-right px-3 py-2 tabular-nums text-gray-800 bg-[#FFE57A]">
                    {formatMetric(pivot.grandTotal, metric, precision)}
                  </td>
                </tr>

                {activeSkuList.map((sku, idx) => (
                  <tr key={sku.codigo} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td
                      className={`px-4 py-2 sticky left-0 z-10 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: sku.color }}
                        />
                        <span className="text-gray-800">{sku.label}</span>
                      </div>
                    </td>
                    {visibleTerritories.map((t) => (
                      <td key={t} className="text-right px-3 py-2 tabular-nums text-gray-700">
                        {formatMetric(pivot.lookup[sku.codigo]?.[t], metric, precision)}
                      </td>
                    ))}
                    <td className="text-right px-3 py-2 tabular-nums font-semibold text-gray-800 bg-amber-50">
                      {formatMetric(pivot.skuTotals[sku.codigo], metric, precision)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
