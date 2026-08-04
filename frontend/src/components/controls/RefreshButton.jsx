import { api } from "../../api";
import useEstadoRefresh from "../../hooks/useEstadoRefresh";

/**
 * Boton "Actualizar" de la cabecera — lo ve todo el mundo.
 *
 * Lanza el ETL del periodo elegido y, cuando termina, llama a onComplete() para
 * que la pestania activa recargue. El estado llega POR EVENTOS (ver
 * useEstadoRefresh): antes se preguntaba cada 5 segundos mientras corria.
 */
export default function RefreshButton({ fechaInicio, fechaFin, onComplete }) {
  const { status } = useEstadoRefresh(onComplete);

  async function trigger() {
    try {
      await api.post("/refresh", { fecha_inicio: fechaInicio, fecha_fin: fechaFin });
      // No se toca el estado a mano: el servidor avisa por el canal en cuanto
      // arranca. Pintarlo aqui seria adivinar, y si el arranque fallara la
      // pantalla diria "actualizando" sin que corriera nada.
    } catch {
      // 409 = ya estaba corriendo. El canal ya lo esta contando; nada que hacer.
    }
  }

  const running = status?.status === "running";
  const progreso = status?.progreso;
  const failed = status?.failed_territories?.length > 0;
  const lastOk = status?.status === "ok" && status?.finished_at;

  return (
    <div className="flex items-center gap-2">
      {lastOk && (
        <span className="text-[11px] opacity-60 hidden md:inline" title={status.finished_at}>
          Actualizado {status.finished_at.slice(11, 16)}
        </span>
      )}
      {failed && !running && (
        <span
          className="text-[11px] text-amber-300"
          title={`Fallaron: ${status.failed_territories.join(", ")}`}
        >
          ⚠ parcial
        </span>
      )}
      <button
        onClick={trigger}
        disabled={running}
        title="Actualizar datos desde AxisPos para el período seleccionado"
        className="flex items-center gap-1.5 text-xs font-semibold bg-white/10 border border-white/25 rounded px-3 py-1.5 hover:bg-white/20 transition-colors disabled:opacity-60"
      >
        <svg
          className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {running
          ? progreso?.total
            ? `Actualizando ${progreso.hechos}/${progreso.total}${progreso.territorio ? ` · ${progreso.territorio}` : ""}`
            : "Actualizando…"
          : "Actualizar"}
      </button>
    </div>
  );
}
