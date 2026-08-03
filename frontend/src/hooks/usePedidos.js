import { useApiQuery, rangeParams } from "./useApiQuery";

/**
 * Pedidos levantados and their conversion to AxisPos facturas.
 *
 * `skus` is a Set of SKU codes (or null = all); it is serialized into the
 * dependency list like every other array dep in this project.
 */
export function usePedidos(filters, skus) {
  const skuList = skus ? [...skus].sort() : [];
  const skuKey = skuList.join(",");

  const { data, loading, error, refetch } = useApiQuery(
    "/pedidos",
    () => {
      const params = rangeParams(filters);
      skuList.forEach((s) => params.append("sku", s));
      return params;
    },
    [filters.fecha_inicio, filters.fecha_fin, filters.territorios.join(","), skuKey]
  );

  return {
    kpis: data?.meta ?? null,
    embudo: data?.embudo ?? [],
    estados: data?.estados ?? [],
    motivos: data?.motivos ?? [],
    porDia: data?.por_dia ?? [],
    porTerritorio: data?.por_territorio ?? [],
    fugasPorTerritorio: data?.fugas_por_territorio ?? [],
    porDomicilio: data?.por_domicilio ?? [],
    porVendedor: data?.por_vendedor ?? [],
    porSku: data?.por_sku ?? [],
    leadtime: data?.leadtime ?? [],
    loading,
    error,
    refetch,
  };
}
