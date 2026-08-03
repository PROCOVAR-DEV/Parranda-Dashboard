import { useApiQuery, rangeParams } from "./useApiQuery";

/** Client purchase analytics: per territory, per day, and top clients. */
export function useClientes(filters) {
  const { data, loading, error, refetch } = useApiQuery(
    "/clientes-compras",
    () => rangeParams(filters),
    [filters.fecha_inicio, filters.fecha_fin, filters.territorios.join(",")]
  );

  return {
    porTerritorio: data?.por_territorio ?? [],
    porDia: data?.por_dia ?? [],
    topClientes: data?.top_clientes ?? [],
    kpis: data?.meta ?? null,
    loading,
    error,
    refetch,
  };
}
