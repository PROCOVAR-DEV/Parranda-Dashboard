import { useApiQuery } from "./useApiQuery";

/** Real vs Meta data for one month (all values in HL; converted in the UI). */
export function useMetaReal(mes) {
  const { data, loading, error, refetch } = useApiQuery(
    "/meta-real",
    () => new URLSearchParams({ mes }),
    [mes]
  );

  return {
    meta: data?.meta ?? null,
    territorios: data?.territorios ?? [],
    loading,
    error,
    refetch,
  };
}
