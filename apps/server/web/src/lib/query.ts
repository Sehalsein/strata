import { QueryClient, useMutation, type MutationFunction } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, errorMessage } from "./api";
import type { LibraryFilters } from "./types";

/**
 * Shared TanStack Query client. Polling pages set `refetchInterval`; TanStack pauses it while
 * the tab is hidden, which is what the old hand-rolled hook did.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (count, err) => {
        // Auth and "not found" answers won't change on retry.
        if (err instanceof ApiError && [400, 401, 403, 404, 409, 429].includes(err.status)) return false;
        return count < 2;
      },
      refetchOnWindowFocus: true,
    },
  },
});

/** Every cache key in one place so features can invalidate each other's data. */
export const queryKeys = {
  info: ["info"] as const,
  me: ["auth", "me"] as const,
  status: ["admin", "status"] as const,
  settings: ["admin", "settings"] as const,
  profiles: ["profiles"] as const,
  devices: ["admin", "devices"] as const,
  logs: (limit: number) => ["admin", "logs", limit] as const,
  files: (filters: LibraryFilters) => ["admin", "files", filters] as const,
  filesAll: ["admin", "files"] as const,
  tmdbSearch: (q: string, type: "movie" | "show") => ["admin", "tmdb", type, q] as const,
  torboxAccount: ["admin", "torbox", "account"] as const,
  updateStatus: ["admin", "update"] as const,
  fs: (path: string | undefined) => ["admin", "fs", path ?? ""] as const,
};

/**
 * useMutation with Strata's defaults: a toast on success (when `success` is given) and on error,
 * plus cache invalidation.
 */
export function useApiMutation<TVars = void, TData = unknown>(
  fn: MutationFunction<TData, TVars>,
  opts: {
    success?: string | ((data: TData, vars: TVars) => string);
    /** Leave errors to the caller (e.g. shown inline in a form). */
    silentError?: boolean;
    invalidate?: readonly (readonly unknown[])[];
    onSuccess?: (data: TData, vars: TVars) => void;
  } = {},
) {
  return useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(data, vars) : opts.success);
      opts.onSuccess?.(data, vars);
      await Promise.all((opts.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(errorMessage(err));
    },
  });
}
