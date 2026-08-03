import { useEffect, useState } from "react";
import { useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import AdminPage from "./pages/AdminPage";
import FilterPanel from "./components/controls/FilterPanel";
import RefreshButton from "./components/controls/RefreshButton";
import VentasTab from "./components/dashboard/VentasTab";
import StockTab from "./components/dashboard/StockTab";
import ClientesTab from "./components/dashboard/ClientesTab";
import PortafolioTab from "./components/dashboard/PortafolioTab";
import MetaRealTab from "./components/dashboard/MetaRealTab";
import PedidosTab from "./components/dashboard/PedidosTab";
import ErrorBanner from "./components/shared/ErrorBanner";
import { useVentas } from "./hooks/useVentas";
import { useStock } from "./hooks/useStock";
import { useClientes } from "./hooks/useClientes";
import { usePortafolio } from "./hooks/usePortafolio";
import { useMetaReal } from "./hooks/useMetaReal";
import { usePedidos } from "./hooks/usePedidos";
import { toggleSkuSelection } from "./components/shared/SkuPills";
import { defaultDateRange, todayISO, currentMonthISO, TERRITORIES } from "./constants";

const TABS = [
  { id: "ventas", label: "Ventas" },
  { id: "stock", label: "Stock" },
  { id: "clientes", label: "Clientes" },
  { id: "portafolio", label: "Portafolio" },
  { id: "pedidos", label: "Pedidos" },
  { id: "metareal", label: "Real vs Meta" },
];

function Dashboard() {
  const { user, logout, isAdmin } = useAuth();

  // Tabs this user may see: admins always get everything; viewers can be
  // restricted via users.allowed_tabs (null = all).
  const visibleTabs = TABS.filter(
    (t) => isAdmin || !user.allowed_tabs || user.allowed_tabs.includes(t.id)
  );
  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.id ?? "ventas");

  useEffect(() => {
    const allowedIds = [...visibleTabs.map((t) => t.id), ...(isAdmin ? ["admin"] : [])];
    if (!allowedIds.includes(activeTab)) setActiveTab(allowedIds[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [filters, setFilters] = useState({ ...defaultDateRange(), territorios: [] });
  const [ventasMetric, setVentasMetric] = useState("hl");
  const [stockMetric, setStockMetric] = useState("hl");
  const [stockFecha, setStockFecha] = useState(todayISO());
  const [metaMes, setMetaMes] = useState(currentMonthISO());
  const [metaMetric, setMetaMetric] = useState("hl");
  const [precision, setPrecision] = useState("enteros");

  // Pedidos tab: SKU selection lives here because the server filters on it
  // (unlike Ventas/Stock, which filter client-side inside the tab).
  const [pedidosSkus, setPedidosSkus] = useState(null);

  const onUpdate = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  // Territory focus from the Clientes cards — same pattern as the SKU pills:
  // all → only this one; toggle membership after; empty/full → back to all.
  const onTerritoryToggle = (t) => {
    setFilters((f) => {
      if (f.territorios.length === 0) return { ...f, territorios: [t] };
      const next = f.territorios.includes(t)
        ? f.territorios.filter((x) => x !== t)
        : [...f.territorios, t];
      return { ...f, territorios: next.length >= TERRITORIES.length ? [] : next };
    });
  };

  const ventas = useVentas(filters);
  const stock = useStock(stockFecha, filters.territorios);
  const clientes = useClientes(filters);
  const portafolio = usePortafolio(filters);
  const metaReal = useMetaReal(metaMes);
  const pedidos = usePedidos(filters, pedidosSkus);

  const refetchAll = () => {
    ventas.refetch();
    stock.refetch();
    clientes.refetch();
    portafolio.refetch();
    metaReal.refetch();
    pedidos.refetch();
  };

  const tabError =
    (activeTab === "ventas" && ventas.error) ||
    (activeTab === "stock" && stock.error) ||
    (activeTab === "clientes" && clientes.error) ||
    (activeTab === "portafolio" && portafolio.error) ||
    (activeTab === "pedidos" && pedidos.error) ||
    (activeTab === "metareal" && metaReal.error) ||
    null;

  const allTabs = isAdmin ? [...visibleTabs, { id: "admin", label: "Admin" }] : visibleTabs;
  const showFilters = ["ventas", "stock", "clientes", "portafolio", "pedidos"].includes(activeTab);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-navy text-white flex items-center px-4 h-14 shrink-0 shadow-md z-20">
        <h1 className="font-bold text-lg tracking-tight">
          Procovar <span className="font-normal opacity-75">— CCSA</span>
        </h1>
        <nav className="flex gap-1 ml-8">
          {allTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-1.5 rounded text-sm transition-colors ${
                activeTab === t.id
                  ? "bg-white/15 font-semibold"
                  : "opacity-75 hover:opacity-100 hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <RefreshButton
            fechaInicio={filters.fecha_inicio}
            fechaFin={filters.fecha_fin}
            onComplete={refetchAll}
          />
          <span className="opacity-75">{user.display_name || user.username}</span>
          <button
            onClick={logout}
            className="text-xs border border-white/30 rounded px-2.5 py-1 hover:bg-white/10 transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {showFilters && (
          <FilterPanel
            activeTab={activeTab}
            filters={filters}
            onUpdate={onUpdate}
            ventasMetric={ventasMetric}
            onVentasMetric={setVentasMetric}
            stockMetric={stockMetric}
            onStockMetric={setStockMetric}
            stockFecha={stockFecha}
            onStockFecha={setStockFecha}
            precision={precision}
            onPrecision={setPrecision}
          />
        )}

        <main className="flex-1 overflow-y-auto pt-4">
          <ErrorBanner message={tabError} />
          {activeTab === "ventas" && (
            <VentasTab
              territoryRows={ventas.territoryRows}
              dailyRows={ventas.dailyRows}
              loading={ventas.loading}
              metric={ventasMetric}
              territorios={filters.territorios}
              precision={precision}
            />
          )}
          {activeTab === "stock" && (
            <StockTab
              rows={stock.rows}
              failedTerritories={stock.failedTerritories}
              loading={stock.loading}
              metric={stockMetric}
              territorios={filters.territorios}
              precision={precision}
            />
          )}
          {activeTab === "clientes" && (
            <ClientesTab
              porTerritorio={clientes.porTerritorio}
              porDia={clientes.porDia}
              topClientes={clientes.topClientes}
              kpis={clientes.kpis}
              loading={clientes.loading}
              territorios={filters.territorios}
              onTerritoryToggle={onTerritoryToggle}
              onResetTerritorios={() => onUpdate("territorios", [])}
            />
          )}
          {activeTab === "portafolio" && (
            <PortafolioTab
              distribucion={portafolio.distribucion}
              kpis={portafolio.kpis}
              combinaciones={portafolio.combinaciones}
              penetracion={portafolio.penetracion}
              loading={portafolio.loading}
              territorios={filters.territorios}
            />
          )}
          {activeTab === "pedidos" && (
            <PedidosTab
              kpis={pedidos.kpis}
              embudo={pedidos.embudo}
              estados={pedidos.estados}
              motivos={pedidos.motivos}
              porDia={pedidos.porDia}
              porTerritorio={pedidos.porTerritorio}
              fugasPorTerritorio={pedidos.fugasPorTerritorio}
              porDomicilio={pedidos.porDomicilio}
              porVendedor={pedidos.porVendedor}
              porSku={pedidos.porSku}
              leadtime={pedidos.leadtime}
              loading={pedidos.loading}
              territorios={filters.territorios}
              precision={precision}
              activeSkus={pedidosSkus}
              onSkuToggle={(codigo) => setPedidosSkus((prev) => toggleSkuSelection(prev, codigo))}
              onSkuReset={() => setPedidosSkus(null)}
            />
          )}
          {activeTab === "metareal" && (
            <MetaRealTab
              meta={metaReal.meta}
              territorios={metaReal.territorios}
              loading={metaReal.loading}
              mes={metaMes}
              onMes={setMetaMes}
              metric={metaMetric}
              onMetric={setMetaMetric}
              precision={precision}
              onPrecision={setPrecision}
            />
          )}
          {activeTab === "admin" && isAdmin && <AdminPage />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy">
        <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return user ? <Dashboard /> : <LoginPage />;
}
