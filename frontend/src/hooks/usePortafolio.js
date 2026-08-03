import { useApiQuery, rangeParams } from "./useApiQuery";

/** Portfolio-diversity analytics over the 5 SKUs. */
export function usePortafolio(filters) {
  const { data, loading, error, refetch } = useApiQuery(
    "/portafolio",
    () => rangeParams(filters),
    [filters.fecha_inicio, filters.fecha_fin, filters.territorios.join(",")]
  );

  return {
    distribucion: data?.distribucion ?? [],
    kpis: data?.kpis ?? null,
    combinaciones: data?.combinaciones ?? [],
    penetracion: data?.penetracion ?? [],
    loading,
    error,
    refetch,
  };
}
