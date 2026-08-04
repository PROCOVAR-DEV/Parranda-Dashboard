import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { API_BASE } from "../constants";

/**
 * Estado del ETL en vivo, por SSE. NADA de preguntar cada X segundos.
 *
 * Antes el boton "Actualizar" preguntaba por el estado cada 5 segundos mientras
 * corria la actualizacion. Eso es preguntar por si acaso: casi siempre la
 * respuesta es "sigo igual", y con varias personas mirando el panel se
 * multiplica por cada una. Ahora el servidor AVISA cuando cambia algo.
 *
 * Dos cosas que hay que saber de este canal:
 *
 * 1. El ticket es de UN SOLO USO. `EventSource` reintenta solo cuando se cae, y
 *    lo hace con la MISMA url — o sea, con el ticket ya gastado, que daria 401
 *    en bucle. Por eso aqui se cierra a mano y se pide un ticket nuevo en cada
 *    reintento.
 *
 * 2. Se espera al evento `ready` antes de dar el canal por bueno. Crear un
 *    EventSource no es estar suscrito: falta la peticion y que el servidor se
 *    enganche. Sin esa confirmacion no se sabe si se esta escuchando de verdad.
 */
export default function useEstadoRefresh(onComplete) {
  const [status, setStatus] = useState(null);
  const [conectado, setConectado] = useState(false);
  const corriendoAntes = useRef(false);
  const onCompleteRef = useRef(onComplete);

  onCompleteRef.current = onComplete;

  useEffect(() => {
    let vivo = true;
    let es = null;
    let reintento = null;
    let esperaMs = 2000;

    const aplicar = (estado) => {
      setStatus(estado);
      if (estado?.status === "running") {
        corriendoAntes.current = true;
      } else if (corriendoAntes.current) {
        corriendoAntes.current = false;
        onCompleteRef.current?.();
      }
    };

    async function abrir() {
      if (!vivo) return;
      try {
        const { data } = await api.post("/refresh/sse-ticket");

        if (!vivo) return;
        es = new EventSource(
          `${API_BASE}/refresh/stream?ticket=${encodeURIComponent(data.ticket)}`,
        );

        es.addEventListener("ready", () => {
          setConectado(true);
          esperaMs = 2000; // conexion buena: se reinicia la espera
        });

        es.addEventListener("estado", (e) => {
          try {
            aplicar(JSON.parse(e.data));
          } catch {
            /* mensaje suelto: se ignora */
          }
        });

        es.onerror = () => {
          setConectado(false);
          es?.close();
          es = null;
          if (!vivo) return;
          // Espera creciente hasta un minuto: si el servidor esta caido, no
          // tiene sentido insistir cada dos segundos desde cada navegador
          // abierto.
          reintento = setTimeout(abrir, esperaMs);
          esperaMs = Math.min(esperaMs * 2, 60000);
        };
      } catch {
        if (!vivo) return;
        reintento = setTimeout(abrir, esperaMs);
        esperaMs = Math.min(esperaMs * 2, 60000);
      }
    }

    abrir();

    return () => {
      vivo = false;
      clearTimeout(reintento);
      es?.close();
    };
  }, []);

  return { status, conectado };
}
