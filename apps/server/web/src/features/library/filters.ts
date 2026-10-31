import type { LibrarySort, MatchStatus, Provider } from "@/lib/types";

export const PAGE_SIZES = [25, 50, 100] as const;

export const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "lastAccessed", label: "Last accessed" },
  { value: "added", label: "Date added" },
  { value: "title", label: "Title" },
  { value: "name", label: "Filename" },
  { value: "size", label: "File size" },
  { value: "year", label: "Release year" },
];

export const STATUS_TABS: { value: MatchStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unmatched", label: "Unmatched" },
  { value: "pending", label: "Pending" },
  { value: "matched", label: "Matched" },
  { value: "manual", label: "Manual" },
  { value: "ignored", label: "Ignored" },
];

export interface LibraryState {
  q: string;
  searchIn: "all" | "title" | "filename";
  status: MatchStatus | "all";
  provider: Provider | "all";
  mediaType: "movie" | "episode" | "all";
  accessed: "yes" | "no" | "all";
  sort: LibrarySort;
  direction: "asc" | "desc";
  pageSize: number;
  page: number;
}

export const DEFAULT_STATE: LibraryState = {
  q: "",
  searchIn: "all",
  status: "all",
  provider: "all",
  mediaType: "all",
  accessed: "all",
  sort: "lastAccessed",
  direction: "desc",
  pageSize: 50,
  page: 0,
};

/** Text sorts read A→Z by default; everything else newest/largest first. */
export const defaultDirection = (sort: LibrarySort): "asc" | "desc" => (sort === "title" || sort === "name" ? "asc" : "desc");

export function directionLabels(sort: LibrarySort): { asc: string; desc: string } {
  if (sort === "title" || sort === "name") return { asc: "A–Z", desc: "Z–A" };
  if (sort === "size") return { asc: "Smallest first", desc: "Largest first" };
  return { asc: "Oldest first", desc: "Newest first" };
}

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Filters live in the URL so they survive reloads and can be linked to (e.g. ?status=unmatched). */
export function readUrlState(search: string): LibraryState {
  const p = new URLSearchParams(search);
  const size = Number(p.get("pageSize"));
  return {
    q: p.get("q")?.slice(0, 200) ?? "",
    searchIn: pick(p.get("searchIn"), ["all", "title", "filename"], "all"),
    status: pick(p.get("status"), ["all", "unmatched", "pending", "matched", "manual", "ignored"], "all"),
    provider: pick(p.get("provider"), ["all", "local", "torbox"], "all"),
    mediaType: pick(p.get("mediaType"), ["all", "movie", "episode"], "all"),
    accessed: pick(p.get("accessed"), ["all", "yes", "no"], "all"),
    sort: pick(p.get("sort"), SORTS.map((s) => s.value), "lastAccessed"),
    direction: pick(p.get("direction"), ["asc", "desc"], "desc"),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : 50,
    page: Math.max(0, Math.floor(Number(p.get("page")) || 1) - 1),
  };
}

export function writeUrlState(s: LibraryState): string {
  const p = new URLSearchParams();
  if (s.status !== "all") p.set("status", s.status);
  if (s.provider !== "all") p.set("provider", s.provider);
  if (s.q) p.set("q", s.q);
  if (s.searchIn !== "all") p.set("searchIn", s.searchIn);
  if (s.mediaType !== "all") p.set("mediaType", s.mediaType);
  if (s.accessed !== "all") p.set("accessed", s.accessed);
  p.set("sort", s.sort);
  p.set("direction", s.direction);
  if (s.pageSize !== 50) p.set("pageSize", String(s.pageSize));
  if (s.page > 0) p.set("page", String(s.page + 1));
  const qs = p.toString();
  return `/library${qs ? `?${qs}` : ""}`;
}

export function isFiltered(s: LibraryState): boolean {
  return !!s.q || s.status !== "all" || s.provider !== "all" || s.mediaType !== "all" || s.accessed !== "all";
}
