import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TERRITORIES } from "../../constants";
import TableSkeleton from "../shared/TableSkeleton";

function fmtDate(iso) {
  if (!iso) return "";
  const parts = iso.split("-");
  return `${parts[2]}/${parts[1]}`;
}

function DayTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{fmtDate(label)}</p>
      <p className="text-gray-600">
        Clientes únicos: <span className="font-mono font-semibold">{payload[0].value}</span>
      </p>
    </div>
  );
}

export default function ClientesTab({
  porTerritorio, porDia, topClientes, kpis, loading,
  territorios, onTerritoryToggle, onResetTerritorios,
}) {
  const allSelected = territorios.length === 0;
  const isSelected = (t) => allSelected || territorios.includes(t);

  const lookup = Object.fromEntries(porTerritorio.map((r) => [r.territorio, r]));

  if (loading) return <div className="px-4 pt-1"><TableSkeleton message="Cargando datos de clientes..." /></div>;

  const hasData = porTerritorio.length > 0;
  const totalClientes = kpis?.total_clientes ?? 0;
  const totalCompras = kpis?.total_compras ?? 0;

  return (
    <div className="px-4 pb-6 space-y-5 pt-1">
      {!hasData ? (
        <div className="text-center text-gray-400 py-16 text-sm">
          Sin datos de clientes para el período seleccionado.
        </div>
      ) : (
        <>
          {/* Interactive territory cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <button
              onClick={onResetTerritorios}
              className={`text-left bg-navy text-white rounded-lg p-4 transition-all ${
                allSelected ? "ring-2 ring-offset-2 ring-navy" : "opacity-80 hover:opacity-100"
              }`}
            >
              <p className="text-[11px] uppercase tracking-wider opacity-75">Total</p>
              <p className="text-2xl font-bold tabular-nums mt-1">{totalClientes.toLocaleString()}</p>
              <p className="text-[11px] opacity-75">
                {totalCompras.toLocaleString()} compras · {kpis?.compras_por_cliente ?? 0}×
              </p>
            </button>
            {TERRITORIES.map((t) => {
              const r = lookup[t];
              const selected = isSelected(t);
              return (
                <button
                  key={t}
                  onClick={() => onTerritoryToggle(t)}
                  className={`text-left bg-white border rounded-lg p-4 transition-all ${
                    selected
                      ? "border-navy ring-1 ring-navy/30 shadow-sm"
                      : "border-gray-200 opacity-50 hover:opacity-80"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wider text-gray-400 truncate" title={t}>
                    {t}
                  </p>
                  <p className="text-2xl font-bold tabular-nums mt-1 text-gray-800">
                    {(r?.clientes_unicos ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {(r?.compras ?? 0).toLocaleString()} compras · {r?.compras_por_cliente ?? 0}×
                  </p>
                </button>
              );
            })}
          </div>

          {/* Chart + top clients */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-navy mb-3">Clientes Únicos por Día</h3>
              {porDia.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">Sin datos</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={porDia} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
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
                      allowDecimals={false}
                      width={48}
                    />
                    <Tooltip content={<DayTooltip />} />
                    <Bar dataKey="clientes_unicos" fill="#1B3A6B" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              <p className="text-[11px] text-gray-400 mt-2">
                Todas las compras de un cliente en un mismo día cuentan como una.
              </p>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-navy mb-3">Top Clientes por Compras</h3>
              {topClientes.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">Sin datos</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 uppercase tracking-wider">
                      <th className="text-left pb-2 font-semibold">Cliente</th>
                      <th className="text-right pb-2 font-semibold">Compras</th>
                      <th className="text-right pb-2 font-semibold">SKUs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topClientes.map((c, idx) => (
                      <tr key={idx} className="border-t border-gray-100">
                        <td className="py-1.5 pr-2">
                          <div className="text-gray-800 truncate max-w-[160px]" title={c.partner_nombre}>
                            {c.partner_nombre}
                          </div>
                          <div className="text-[10px] text-gray-400">{c.territorio}</div>
                        </td>
                        <td className="text-right tabular-nums font-semibold text-gray-700">
                          {c.compras}
                        </td>
                        <td className="text-right tabular-nums text-gray-500">{c.skus_distintos}/5</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Per-territory breakdown table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-2.5 font-semibold min-w-[160px]">Territorio</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Clientes Únicos</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Compras</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Compras × Cliente</th>
                  <th className="text-right px-3 py-2.5 font-semibold">% de Clientes</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-[#FFF2CC] font-semibold">
                  <td className="px-4 py-2 text-gray-800">TOTAL</td>
                  <td className="text-right px-3 py-2 tabular-nums text-gray-800">
                    {totalClientes.toLocaleString()}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-gray-800">
                    {totalCompras.toLocaleString()}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-gray-800">
                    {kpis?.compras_por_cliente ?? 0}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-gray-800">100%</td>
                </tr>
                {porTerritorio.map((r, idx) => (
                  <tr key={r.territorio} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-4 py-2 text-gray-800">{r.territorio}</td>
                    <td className="text-right px-3 py-2 tabular-nums text-gray-700">
                      {r.clientes_unicos.toLocaleString()}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums text-gray-700">
                      {r.compras.toLocaleString()}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums text-gray-700">
                      {r.compras_por_cliente}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums text-gray-500">
                      {totalClientes > 0 ? ((r.clientes_unicos / totalClientes) * 100).toFixed(1) : 0}%
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
