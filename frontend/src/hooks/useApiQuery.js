import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DEBOUNCE_MS } from "../constants";

/**
 * Debounced GET hook. `params` is serialized into the dependency list, so pass
 * primitives / stable strings (e.g. territorios.join(",")) — never fresh objects.
 *
 * buildParams: () => URLSearchParams
 */
export function useApiQuery(url, buildParams, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const buildRef = useRef(buildParams);
  buildRef.current = buildParams;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(url, { params: buildRef.current() });
      setData(res.data);
    } catch (err) {
      if (err.response?.status !== 401) {
        setError(err.response?.data?.error || "Error al cargar datos");
      }
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchData, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function rangeParams(filters, extra = {}) {
  const params = new URLSearchParams({
    fecha_inicio: filters.fecha_inicio,
    fecha_fin: filters.fecha_fin,
    ...extra,
  });
  filters.territorios.forEach((t) => params.append("territorio", t));
  return params;
}
