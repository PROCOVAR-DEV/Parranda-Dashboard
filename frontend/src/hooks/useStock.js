import { useApiQuery } from "./useApiQuery";

/** Live Parranda stock snapshot (blisters) for a single date. */
export function useStock(fecha, territorios) {
  const { data, loading, error, refetch } = useApiQuery(
    "/stock",
    () => {
      const params = new URLSearchParams({ fecha });
      territorios.forEach((t) => params.append("territorio", t));
      return params;
    },
    [fecha, territorios.join(",")]
  );

  return {
    rows: data?.rows ?? [],
    failedTerritories: data?.meta?.territorios_fallidos ?? [],
    loading,
    error,
    refetch,
  };
}
