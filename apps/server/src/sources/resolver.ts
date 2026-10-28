import type { FileRow, Library } from "../library";
import type { ParsedName } from "../media/parse";
import type { MediaInfo } from "../media/probe";
import type { Settings } from "../settings";
import type { FileProvider } from "../db/schema";

export interface Candidate {
  id: string;
  fileId: number;
  provider: FileProvider;
  name: string;
  size: number;
  resolution?: number;
  source?: ParsedName["source"];
  videoCodec?: string;
  hdr?: string | null;
  audio?: { codec: string; channels: number; language?: string }[];
  durationMs?: number;
  probed: boolean;
  /** ready: in the library. cached: TorBox can serve it instantly once added. uncached: must download first. */
  availability: "ready" | "cached" | "uncached";
  seeders?: number;
  /** Torrent name, for discovered releases. */
  releaseTitle?: string;
  isPack?: boolean;
  // For the apps to show as they are (they know nothing about providers).
  /** The source's name. */
  label: string;
  /** Where it comes from: "Library", or the service it would play from. */
  originLabel: string;
  /** Size and other facts, e.g. "48.3 GB · 42 seeders". */
  detail?: string;
}

const PROVIDER_LABEL: Record<FileProvider, string> = { local: "Library", torbox: "TorBox" };

/** "48.3 GB", "700 MB"; undefined when unknown. */
export function sizeLabel(bytes: number): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** The detail line under a source: size, then seeders for found releases. */
export function detailLabel(size: number, seeders?: number): string | undefined {
  return [sizeLabel(size), seeders !== undefined ? `${seeders} seeder${seeders === 1 ? "" : "s"}` : undefined].filter(Boolean).join(" · ") || undefined;
}

const SOURCE_RANK: Record<NonNullable<ParsedName["source"]>, number> = { remux: 5, bluray: 4, web: 3, hdtv: 2, dvd: 1, cam: 0 };

export function toCandidate(file: FileRow): Candidate {
  const parsed = JSON.parse(file.parsedJson ?? "{}") as ParsedName;
  const probe = file.probeJson ? (JSON.parse(file.probeJson) as MediaInfo) : undefined;
  return {
    id: `file:${file.id}`,
    fileId: file.id,
    provider: file.provider,
    name: file.name,
    size: file.size,
    resolution: probe?.video ? heightToResolution(probe.video.height, probe.video.width) : parsed.resolution,
    source: parsed.source,
    videoCodec: probe?.video?.codec ?? parsed.videoCodec,
    hdr: probe ? (probe.video?.hdr ?? null) : (parsed.hdr ?? null),
    audio: probe?.audio.map((a) => ({ codec: a.codec, channels: a.channels, language: a.language })),
    durationMs: probe?.durationMs,
    probed: !!probe,
    availability: "ready",
    label: file.name,
    originLabel: PROVIDER_LABEL[file.provider],
    detail: detailLabel(file.size),
  };
}

/** Nominal resolution from frame size; widescreen crops (1920x800) still count as 1080p. */
export function heightToResolution(height: number, width: number): number {
  const h = Math.max(height, Math.round((width * 9) / 16));
  if (h >= 1800) return 2160;
  if (h >= 900) return 1080;
  if (h >= 650) return 720;
  if (h >= 500) return 576;
  return 480;
}

export function rankCandidates(candidates: Candidate[], settings: Pick<Settings, "sourcePriority" | "maxResolution">): Candidate[] {
  const priority = (p: FileProvider) => {
    const i = settings.sourcePriority.indexOf(p);
    return i === -1 ? 99 : i;
  };
  const withinCap = (c: Candidate) => (c.resolution ?? 1080) <= settings.maxResolution;
  return [...candidates].sort(
    (a, b) =>
      Number(withinCap(b)) - Number(withinCap(a)) ||
      priority(a.provider) - priority(b.provider) ||
      (b.resolution ?? 0) - (a.resolution ?? 0) ||
      (SOURCE_RANK[b.source ?? "dvd"] ?? 0) - (SOURCE_RANK[a.source ?? "dvd"] ?? 0) ||
      b.size - a.size,
  );
}

export function findCandidates(library: Library, settings: Settings, mediaType: "movie" | "episode", tmdbId: number, season?: number, episode?: number): Candidate[] {
  return rankCandidates(library.filesFor(mediaType, tmdbId, season, episode).map(toCandidate), settings);
}
