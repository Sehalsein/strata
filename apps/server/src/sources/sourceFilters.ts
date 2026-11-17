import type { Candidate } from "./resolver";

/**
 * Choose Source's filters, worked out here so the apps hold no idea of what 4K, HDR or a
 * duplicate is: the server merges copies of the same release, says which filter options
 * each source falls under (`filterTags`), and lists the groups worth offering with how
 * many sources each option has. The apps draw the groups as chips (one choice per group)
 * and keep the sources whose tags include every chosen option.
 */
export interface FilterOption {
  /** "<group>:<value>", as it appears in sources' `filterTags`. */
  id: string;
  label: string;
  count: number;
}

export interface FilterGroup {
  id: string;
  title: string;
  options: FilterOption[];
}

export type FilteredCandidate = Candidate & { filterTags: string[] };

const GB = 1024 ** 3;

const GROUPS: { id: string; title: string; values: (c: Candidate) => { id: string; label: string; order: number }[] }[] = [
  {
    id: "quality",
    title: "Quality",
    values: (c) => {
      const r = c.resolution ?? 0;
      if (r >= 2160) return [{ id: "2160", label: "4K", order: 0 }];
      if (r >= 1080) return [{ id: "1080", label: "1080p", order: 1 }];
      if (r > 0) return [{ id: "720", label: "720p and lower", order: 2 }];
      return [];
    },
  },
  {
    id: "ready",
    title: "Availability",
    values: (c) => (c.availability === "uncached" ? [] : [{ id: "now", label: "Plays now", order: 0 }]),
  },
  {
    id: "hdr",
    title: "Picture",
    values: (c) => {
      const h = c.hdr?.toLowerCase();
      if (h === "dv") return [{ id: "dv", label: "Dolby Vision", order: 0 }];
      if (h) return [{ id: "hdr", label: "HDR", order: 1 }];
      return c.hdr === null || c.probed || c.resolution ? [{ id: "sdr", label: "SDR", order: 2 }] : [];
    },
  },
  {
    id: "size",
    title: "Size",
    values: (c) => {
      if (!c.size) return [];
      if (c.size < 5 * GB) return [{ id: "s", label: "Under 5 GB", order: 0 }];
      if (c.size <= 20 * GB) return [{ id: "m", label: "5–20 GB", order: 1 }];
      return [{ id: "l", label: "Over 20 GB", order: 2 }];
    },
  },
];

/** Audio languages of a source: the file's own tracks when known, else what its release says. */
function languagesOf(c: Candidate): string[] {
  const fromAudio = (c.audio ?? []).map((a) => normalize(a.language)).filter((l): l is string => !!l && l !== "und");
  return [...new Set(fromAudio.length ? fromAudio : (c.languages ?? []).filter((l) => l !== "multi"))];
}

const ISO639_2: Record<string, string> = { eng: "en", spa: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", jpn: "ja", kor: "ko", chi: "zh", zho: "zh", rus: "ru", hin: "hi" };
const normalize = (code?: string) => (code ? (ISO639_2[code.toLowerCase()] ?? code.split("-")[0]!.toLowerCase()) : undefined);

/**
 * Copies of one release under several names (the same file as a torrent and as an add-on's
 * link, or from two add-ons): kept once, the best-ranked, with where else it's offered in
 * its detail line. Same release = same file name (or title) and the same size within 1%.
 */
export function collapseDuplicates(candidates: Candidate[]): Candidate[] {
  const kept: { c: Candidate; key: string; also: Set<string> }[] = [];
  const keyOf = (c: Candidate) => (c.releaseTitle ?? c.name).toLowerCase().replace(/\.(mkv|mp4|avi|m4v|webm)$/, "").replace(/[^a-z0-9]+/g, "");
  for (const c of candidates) {
    // Library files are the household's own: never folded into a found copy.
    if (c.availability === "ready") {
      kept.push({ c, key: "", also: new Set() });
      continue;
    }
    const key = keyOf(c);
    const twin = key && c.size ? kept.find((k) => k.key === key && k.c.size && Math.abs(k.c.size - c.size) <= k.c.size * 0.01) : undefined;
    if (twin) {
      if (c.originLabel && c.originLabel !== twin.c.originLabel) twin.also.add(c.originLabel);
      continue;
    }
    kept.push({ c, key, also: new Set() });
  }
  return kept.map(({ c, also }) => (also.size ? { ...c, detail: [c.detail, `Also on ${[...also].join(", ")}`].filter(Boolean).join(" · ") } : c));
}

/**
 * The sources with their filter tags, and the groups worth offering: a group shows when it
 * tells sources apart (two options or more, or one that not every source has); options
 * come in their natural order with their counts.
 */
export function withFilters(candidates: Candidate[], languageName: (code: string) => string): { items: FilteredCandidate[]; filters: FilterGroup[] } {
  const groups = new Map<string, { title: string; options: Map<string, { label: string; order: number; count: number }> }>();
  const items = candidates.map((c) => {
    const tags: string[] = [];
    const add = (group: string, title: string, id: string, label: string, order: number) => {
      const tag = `${group}:${id}`;
      tags.push(tag);
      const g = groups.get(group) ?? { title, options: new Map() };
      const o = g.options.get(tag) ?? { label, order, count: 0 };
      o.count++;
      g.options.set(tag, o);
      groups.set(group, g);
    };
    for (const group of GROUPS) for (const v of group.values(c)) add(group.id, group.title, v.id, v.label, v.order);
    for (const lang of languagesOf(c)) add("lang", "Audio", lang, languageName(lang), 0);
    return { ...c, filterTags: tags };
  });
  const order = [...GROUPS.map((g) => g.id), "lang"];
  const filters: FilterGroup[] = [];
  for (const id of order) {
    const g = groups.get(id);
    if (!g) continue;
    const options = [...g.options.entries()]
      .sort(([, a], [, b]) => a.order - b.order || b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, id === "lang" ? 8 : undefined)
      .map(([tag, o]) => ({ id: tag, label: o.label, count: o.count }));
    const splits = options.length >= 2 || (options.length === 1 && options[0]!.count < items.length);
    if (splits) filters.push({ id, title: g.title, options });
  }
  return { items, filters };
}
