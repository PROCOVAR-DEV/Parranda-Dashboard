import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { POLL_INTERVAL_MS } from "../../constants";

/**
 * Header "Actualizar" button — available to every user.
 * Triggers the ETL for the currently selected date range, polls until it
 * finishes, then calls onComplete() so the active tab refetches.
 */
export default function RefreshButton({ fechaInicio, fechaFin, onComplete }) {
  const [status, setStatus] = useState(null);
  const pollRef = useRef(null);
  const wasRunningRef = useRef(false);

  const poll = useCallback(() => {
    api
      .get("/refresh/status")
      .then((r) => {
        setStatus(r.data);
        if (r.data.status === "running") {
          wasRunningRef.current = true;
          pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } else if (wasRunningRef.current) {
          wasRunningRef.current = false;
          onComplete?.();
        }
      })
      .catch(() => {});
  }, [onComplete]);

  useEffect(() => {
    poll();
    return () => clearTimeout(pollRef.current);
  }, [poll]);

  async function trigger() {
    try {
      await api.post("/refresh", { fecha_inicio: fechaInicio, fecha_fin: fechaFin });
      wasRunningRef.current = true;
      setStatus({ status: "running" });
      pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    } catch {
      poll(); // 409 = already running → resync
    }
  }

  const running = status?.status === "running";
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
        {running ? "Actualizando…" : "Actualizar"}
      </button>
    </div>
  );
}
