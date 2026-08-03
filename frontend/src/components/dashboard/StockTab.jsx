import { useMemo, useState } from "react";
import { TERRITORIES, SKUS, convertMetric, formatMetric } from "../../constants";
import SkuPills, { effectiveSkuSet, toggleSkuSelection } from "../shared/SkuPills";
import TableSkeleton from "../shared/TableSkeleton";

const METRIC_LABEL = { blister: "BLISTERS", hl: "HL" };

export default function StockTab({ rows, failedTerritories, loading, metric, territorios, precision }) {
  const [activeSkus, setActiveSkus] = useState(null);

  const effective = effectiveSkuSet(activeSkus);
  const activeSkuList = SKUS.filter((s) => effective.has(s.codigo));

  const visibleTerritories =
    territorios.length === 0 ? TERRITORIES : TERRITORIES.filter((t) => territorios.includes(t));

  const pivot = useMemo(() => {
    const lookup = {};
    const skuTotals = {};
    const terTotals = {};
    let grandTotal = 0;
    rows.forEach((r) => {
      if (!effective.has(r.sku_codigo)) return;
      const v = convertMetric(r.cantidad_actual, r.sku_codigo, metric);
      if (!lookup[r.sku_codigo]) lookup[r.sku_codigo] = {};
      lookup[r.sku_codigo][r.territorio] = (lookup[r.sku_codigo][r.territorio] || 0) + v;
      skuTotals[r.sku_codigo] = (skuTotals[r.sku_codigo] || 0) + v;
      terTotals[r.territorio] = (terTotals[r.territorio] || 0) + v;
      grandTotal += v;
    });
    return { lookup, skuTotals, terTotals, grandTotal };
  }, [rows, effective, metric]);

  return (
    <div className="px-4 pb-6 space-y-5">
      <div className="pt-1">
        <SkuPills
          activeSkus={activeSkus}
          onToggle={(codigo) => setActiveSkus((prev) => toggleSkuSelection(prev, codigo))}
          onReset={() => setActiveSkus(null)}
        />
      </div>

      {failedTerritories.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded px-4 py-2.5">
          No se pudo consultar el stock de: {failedTerritories.join(", ")}
        </div>
      )}

      {loading ? (
        <TableSkeleton message="Cargando datos de stock..." />
      ) : rows.length === 0 ? (
        <div className="text-center text-gray-400 py-16 text-sm">
          Sin datos de stock para la fecha seleccionada.
        </div>
      ) : (
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
                  STOCK PARRANDA ({METRIC_LABEL[metric]})
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
      )}
    </div>
  );
}
