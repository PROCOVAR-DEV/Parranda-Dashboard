/**
 * Application-wide constants for Procovar - Parranda.
 * Import from here — never hardcode these values elsewhere.
 */

/** Canonical territory order — Bayamo intentionally excluded. */
export const TERRITORIES = [
  "Havana",
  "Sancti Spíritus",
  "Camagüey",
  "Las Tunas",
  "Holguín",
  "Moa",
  "Santiago de Cuba",
  "Palma Soriano",
  "Guantánamo",
];

/**
 * The 5 tracked SKUs in canonical order.
 * cantidad from the API is in BLISTERS. hl = cantidad × hlFactor.
 * unidades = cantidad × 6 (each blister holds 6 bottles).
 */
export const SKUS = [
  { codigo: "P1500", label: "Parranda 1500", color: "#F59E0B", hlFactor: 0.09 },
  { codigo: "P500",  label: "Parranda 500",  color: "#3B82F6", hlFactor: 0.03 },
  { codigo: "P330",  label: "Parranda 330",  color: "#10B981", hlFactor: 0.0198 },
  { codigo: "M1500", label: "Malta 1500",    color: "#8B5CF6", hlFactor: 0.09 },
  { codigo: "M330",  label: "Malta 330",     color: "#F43F5E", hlFactor: 0.0198 },
];

export const SKU_BY_CODE = Object.fromEntries(SKUS.map((s) => [s.codigo, s]));

export const UNITS_PER_BLISTER = 6;

/** Sales metric options (one at a time). */
export const VENTAS_METRIC_OPTIONS = [
  { value: "hl",       label: "HL" },
  { value: "blister",  label: "Blister" },
  { value: "unidades", label: "Unidades" },
];

/** Stock metric options. */
export const STOCK_METRIC_OPTIONS = [
  { value: "blister", label: "Cantidad" },
  { value: "hl",      label: "HL" },
];

/** Convert a blister quantity for one SKU into the requested metric. */
export function convertMetric(cantidadBlisters, skuCodigo, metric) {
  const qty = Number(cantidadBlisters) || 0;
  if (metric === "hl") return qty * (SKU_BY_CODE[skuCodigo]?.hlFactor ?? 0);
  if (metric === "unidades") return qty * UNITS_PER_BLISTER;
  return qty; // blister
}

// ── Pedidos ───────────────────────────────────────────────────────────────────

/**
 * Territories that exist as a sucursal in the Sistema de Pedidos.
 * Moa and Palma Soriano bill through AxisPos but have no sucursal there, so they
 * would otherwise render as permanently-empty rows. Keep in sync with
 * backend/config.py PEDIDOS_SUCURSAL_MAP.
 */
export const PEDIDOS_TERRITORIES = TERRITORIES.filter(
  (t) => !["Moa", "Palma Soriano"].includes(t)
);

export const PEDIDO_ESTADO_LABELS = {
  en_proceso: "En proceso",
  completada: "Completado",
  expirada: "Expirado",
};

/** Why an unconverted pedido never became a factura (backend routes/pedidos.py). */
export const PEDIDO_MOTIVO_LABELS = {
  expirada: "Expirado (72h)",
  completada_sin_factura: "Completado sin factura",
  en_proceso_vencido: "En proceso vencido",
  en_proceso_vigente: "En proceso vigente",
};

/** Motivos that represent a real loss — en_proceso_vigente is still in play. */
export const PEDIDO_MOTIVO_COLORS = {
  expirada: "#F43F5E",
  completada_sin_factura: "#F59E0B",
  en_proceso_vencido: "#8B5CF6",
  en_proceso_vigente: "#94A3B8",
};

/** Metric of the sucursal × día matrix (one at a time). */
export const PEDIDOS_METRIC_OPTIONS = [
  { value: "pedidos",     label: "Pedidos" },
  { value: "convertidos", label: "Convertidos" },
  { value: "conversion",  label: "% Conversión" },
  { value: "hl",          label: "HL" },
];

/**
 * Count-vs-volume toggle shared by the Conversión, Vendedores, Domicilio and
 * Resumen-cobertura tables. In "hl" mode the conversion percentage is weighted by
 * volume, so an unconverted 40 HL pedido hurts more than an unconverted 0.5 HL one.
 */
export const PEDIDOS_UNIT_OPTIONS = [
  { value: "pedidos", label: "Pedidos" },
  { value: "hl",      label: "HL" },
];

/** Precision options: whole numbers (default) or 2 decimals. */
export const PRECISION_OPTIONS = [
  { value: "enteros", label: "Enteros" },
  { value: "exacto",  label: "Exacto" },
];

/** Format a metric value. precision: "enteros" (default, rounded) | "exacto" (2 decimals). */
export function formatMetric(value, metric, precision = "enteros") {
  if (value === null || value === undefined || value === 0) return "—";
  const n = Number(value);
  if (precision === "exacto") {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return Math.round(n).toLocaleString("en-US");
}

// ── Dates ─────────────────────────────────────────────────────────────────────

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function defaultDateRange() {
  const today = new Date();
  return {
    fecha_inicio: toISO(new Date(today.getFullYear(), today.getMonth(), 1)),
    fecha_fin: toISO(today),
  };
}

export function dateRangeToday() {
  const t = todayISO();
  return { fecha_inicio: t, fecha_fin: t };
}

export function dateRangeThisWeek() {
  const today = new Date();
  const day = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  return { fecha_inicio: toISO(monday), fecha_fin: toISO(today) };
}

export function dateRangeThisMonth() {
  return defaultDateRange();
}

export function dateRangeThisYear() {
  const today = new Date();
  return { fecha_inicio: `${today.getFullYear()}-01-01`, fecha_fin: toISO(today) };
}

export function currentMonthISO() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export const API_BASE = "/api";
export const POLL_INTERVAL_MS = 5000;
export const DEBOUNCE_MS = 300;
