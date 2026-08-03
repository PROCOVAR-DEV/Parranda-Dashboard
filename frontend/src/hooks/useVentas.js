import { useApiQuery, rangeParams } from "./useApiQuery";

/** Net Parranda sales: territory pivot rows + daily chart rows (both in blisters). */
export function useVentas(filters) {
  const deps = [filters.fecha_inicio, filters.fecha_fin, filters.territorios.join(",")];

  const territory = useApiQuery(
    "/ventas",
    () => rangeParams(filters, { group_by: "territorio_sku" }),
    deps
  );
  const daily = useApiQuery(
    "/ventas",
    () => rangeParams(filters, { group_by: "fecha_sku" }),
    deps
  );

  return {
    territoryRows: territory.data?.rows ?? [],
    dailyRows: daily.data?.rows ?? [],
    loading: territory.loading || daily.loading,
    error: territory.error || daily.error,
    refetch: () => {
      territory.refetch();
      daily.refetch();
    },
  };
}
