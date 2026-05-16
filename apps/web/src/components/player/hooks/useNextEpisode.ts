import { useQuery } from "@tanstack/react-query";
import { getEpisodes, type BaseItemDto } from "@/lib/api";

export type NextEpisodeResult = {
  next: BaseItemDto | null;
  prev: BaseItemDto | null;
  loading: boolean;
};

/**
 * Resolves the previous and next episode siblings for a given episode item.
 * Returns null for movies (no SeriesId), the first episode (no prev), or
 * the series finale (no next).
 */
export const useNextEpisode = (item: BaseItemDto | null): NextEpisodeResult => {
  const seriesId = item?.SeriesId ?? null;
  const query = useQuery({
    queryKey: ["episodes", seriesId],
    queryFn: () => getEpisodes(seriesId!),
    enabled: Boolean(seriesId),
    staleTime: 5 * 60_000,
  });

  if (!seriesId || !item) {
    return { next: null, prev: null, loading: false };
  }
  const episodes = query.data ?? [];
  const idx = episodes.findIndex((e) => e.Id === item.Id);
  if (idx === -1) {
    return { next: null, prev: null, loading: query.isLoading };
  }
  return {
    prev: idx > 0 ? episodes[idx - 1]! : null,
    next: idx < episodes.length - 1 ? episodes[idx + 1]! : null,
    loading: query.isLoading,
  };
};
