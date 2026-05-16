import type { BaseItemDto } from "@/lib/api";

export type Stream = {
  Index: number;
  Language: string | null;
  DisplayTitle: string | null;
  Codec: string | null;
  IsForced: boolean;
  IsDefault: boolean;
  IsExternal: boolean;
  IsTextSubtitleStream: boolean;
};

export const collectAudioStreams = (item: BaseItemDto): Stream[] =>
  (item.MediaSources?.[0]?.MediaStreams ?? [])
    .filter((s) => s.Type === "Audio" && s.Index !== undefined)
    .map((s) => ({
      Index: s.Index!,
      Language: s.Language ?? null,
      DisplayTitle: s.DisplayTitle ?? null,
      Codec: s.Codec ?? null,
      IsForced: Boolean(s.IsForced),
      IsDefault: Boolean(s.IsDefault),
      IsExternal: Boolean(s.IsExternal),
      IsTextSubtitleStream: Boolean(s.IsTextSubtitleStream),
    }));

export const collectSubtitleStreams = (item: BaseItemDto): Stream[] =>
  (item.MediaSources?.[0]?.MediaStreams ?? [])
    .filter(
      (s) =>
        s.Type === "Subtitle" &&
        s.Index !== undefined &&
        // Image-based subs (PGS/SUP) can't be rendered by hls.js / browser
        s.IsTextSubtitleStream !== false,
    )
    .map((s) => ({
      Index: s.Index!,
      Language: s.Language ?? null,
      DisplayTitle: s.DisplayTitle ?? null,
      Codec: s.Codec ?? null,
      IsForced: Boolean(s.IsForced),
      IsDefault: Boolean(s.IsDefault),
      IsExternal: Boolean(s.IsExternal),
      IsTextSubtitleStream: Boolean(s.IsTextSubtitleStream),
    }));

export type Chapter = {
  name: string;
  startSeconds: number;
};

export const collectChapters = (item: BaseItemDto): Chapter[] => {
  const list = item.Chapters ?? [];
  return list
    .filter((c) => c.StartPositionTicks !== undefined && c.StartPositionTicks !== null)
    .map((c, i) => ({
      name: c.Name ?? `Chapter ${i + 1}`,
      startSeconds: Math.max(0, Math.round((c.StartPositionTicks ?? 0) / 10_000_000)),
    }));
};

export type PlayerApi = {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (sec: number) => void;
  seekBy: (delta: number) => void;
  setRate: (rate: number) => void;
  /** Cycles 1× → 1.5× → 2× → 1× regardless of current setting. */
  cycleSpeed: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  /** Toggles subtitles on/off; restores the last-used track when turning on. */
  toggleSubtitle: () => void;
  /** Toggles the chapters/up-next rail visibility. */
  toggleRail: () => void;
  prevEpisode: (() => void) | null;
  nextEpisode: (() => void) | null;
};
