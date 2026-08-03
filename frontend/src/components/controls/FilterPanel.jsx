import {
  TERRITORIES, VENTAS_METRIC_OPTIONS, STOCK_METRIC_OPTIONS, PRECISION_OPTIONS,
  dateRangeToday, dateRangeThisWeek, dateRangeThisMonth, dateRangeThisYear,
} from "../../constants";

const QUICK_DATES = [
  { label: "Hoy", fn: dateRangeToday },
  { label: "Esta semana", fn: dateRangeThisWeek },
  { label: "Este mes", fn: dateRangeThisMonth },
  { label: "Este año", fn: dateRangeThisYear },
];

/**
 * Left sidebar filters. Sections adapt to the active tab:
 *  - ventas:    date range + HL/Blister/Unidades metric + territories
 *  - stock:     single date + Cantidad/HL metric + territories
 *  - clientes / portafolio: date range + territories (no metric)
 */
export default function FilterPanel({
  activeTab, filters, onUpdate,
  ventasMetric, onVentasMetric,
  stockMetric, onStockMetric,
  stockFecha, onStockFecha,
  precision, onPrecision,
}) {
  function toggleTerritory(t) {
    const list = filters.territorios.includes(t)
      ? filters.territorios.filter((x) => x !== t)
      : [...filters.territorios, t];
    onUpdate("territorios", list);
  }

  const isAllSelected = filters.territorios.length === 0;
  const showMetric = activeTab === "ventas" || activeTab === "stock";
  const showRange = activeTab !== "stock";
  // Pedidos picks its own metric inside the tab but still renders HL figures,
  // so it shares the Enteros/Exacto toggle.
  const showPrecision = showMetric || activeTab === "pedidos";

  return (
    <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* ── Date section ── */}
        {showRange ? (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Período
            </h3>
            <div className="grid grid-cols-2 gap-1 mb-3">
              {QUICK_DATES.map(({ label, fn }) => {
                const { fecha_inicio, fecha_fin } = fn();
                const active =
                  filters.fecha_inicio === fecha_inicio && filters.fecha_fin === fecha_fin;
                return (
                  <button
                    key={label}
                    onClick={() => {
                      const r = fn();
                      onUpdate("fecha_inicio", r.fecha_inicio);
                      onUpdate("fecha_fin", r.fecha_fin);
                    }}
                    className={`text-xs px-2 py-1.5 rounded border transition-colors ${
                      active
                        ? "bg-navy text-white border-navy"
                        : "bg-white text-gray-600 border-gray-300 hover:border-navy hover:text-navy"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Desde</label>
                <input
                  type="date"
                  value={filters.fecha_inicio}
                  onChange={(e) => onUpdate("fecha_inicio", e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Hasta</label>
                <input
                  type="date"
                  value={filters.fecha_fin}
                  onChange={(e) => onUpdate("fecha_fin", e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
                />
              </div>
            </div>
          </section>
        ) : (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Fecha de Stock
            </h3>
            <input
              type="date"
              value={stockFecha}
              onChange={(e) => onStockFecha(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
            />
            <p className="text-xs text-gray-400 mt-1">Existencia al cierre de ese día.</p>
          </section>
        )}

        {/* ── Metric ── */}
        {showMetric && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Métrica
            </h3>
            <div className="flex rounded border border-gray-300 overflow-hidden">
              {(activeTab === "stock" ? STOCK_METRIC_OPTIONS : VENTAS_METRIC_OPTIONS).map((o) => {
                const current = activeTab === "stock" ? stockMetric : ventasMetric;
                const onClick =
                  activeTab === "stock" ? () => onStockMetric(o.value) : () => onVentasMetric(o.value);
                return (
                  <button
                    key={o.value}
                    onClick={onClick}
                    className={`flex-1 text-xs py-1.5 transition-colors ${
                      current === o.value
                        ? "bg-navy text-white font-semibold"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Precision (Enteros / Exacto) ── */}
        {showPrecision && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Visual
            </h3>
            <div className="flex rounded border border-gray-300 overflow-hidden">
              {PRECISION_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => onPrecision(o.value)}
                  className={`flex-1 text-xs py-1.5 transition-colors ${
                    precision === o.value
                      ? "bg-navy text-white font-semibold"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Territories ── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Territorios
            </h3>
            <button
              onClick={() => onUpdate("territorios", [])}
              className="text-xs text-navy hover:underline"
            >
              {isAllSelected ? "Todos ✓" : "Todos"}
            </button>
          </div>
          <div className="space-y-1">
            {TERRITORIES.map((t) => {
              const checked = isAllSelected || filters.territorios.includes(t);
              return (
                <label key={t} className="flex items-center gap-2 cursor-pointer text-sm py-0.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTerritory(t)}
                    className="accent-[#1B3A6B] w-3.5 h-3.5"
                  />
                  <span className={checked ? "text-gray-800" : "text-gray-400"}>{t}</span>
                </label>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}
