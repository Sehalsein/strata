import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { FfmpegInfo } from "../platform/ffmpeg";
import type { MediaInfo } from "../media/probe";
import { logger, redactSecrets } from "../log";

const log = logger("subtitles");
const SIDECAR_EXTENSIONS = new Set([".srt", ".vtt", ".ass", ".ssa"]);

export interface SubtitleTrack {
  /** "s<streamIndex>" for embedded tracks, "x<n>" for sidecar files. */
  id: string;
  codec: string;
  language?: string;
  title?: string;
  forced: boolean;
  isDefault: boolean;
  external: boolean;
  /** Text tracks convert to WebVTT; bitmap ones (PGS, VobSub) can't yet. */
  text: boolean;
  /** Embedded stream index, or the sidecar's path. */
  source: number | string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  english: "en", eng: "en", en: "en", spanish: "es", spa: "es", es: "es", french: "fr", fre: "fr", fra: "fr", fr: "fr",
  german: "de", ger: "de", deu: "de", de: "de", italian: "it", ita: "it", it: "it", portuguese: "pt", por: "pt", pt: "pt",
  japanese: "ja", jpn: "ja", ja: "ja", korean: "ko", kor: "ko", ko: "ko", chinese: "zh", chi: "zh", zho: "zh", zh: "zh",
  russian: "ru", rus: "ru", ru: "ru", hindi: "hi", hin: "hi", hi: "hi", arabic: "ar", ara: "ar", ar: "ar", dutch: "nl", dut: "nl", nld: "nl", nl: "nl",
};

/** Subtitle files beside a local video: "Movie.srt", "Movie.en.srt", "Movie.eng.forced.srt", "Movie.English.sdh.srt". */
export function findSidecars(videoPath: string): SubtitleTrack[] {
  const dir = dirname(videoPath);
  const stem = basename(videoPath, extname(videoPath)).toLowerCase();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => SIDECAR_EXTENSIONS.has(extname(n).toLowerCase()) && n.toLowerCase().startsWith(stem))
    .sort()
    .map((name, i) => {
      const tags = name.slice(stem.length, -extname(name).length).toLowerCase().split(/[._\s-]+/).filter(Boolean);
      const language = tags.map((t) => LANGUAGE_NAMES[t]).find(Boolean);
      return {
        id: `x${i}`,
        codec: extname(name).slice(1).toLowerCase(),
        language,
        title: tags.includes("sdh") || tags.includes("cc") ? "SDH" : undefined,
        forced: tags.includes("forced"),
        isDefault: false,
        external: true,
        text: true,
        source: join(dir, name),
      };
    });
}

export function embeddedTracks(info: MediaInfo): SubtitleTrack[] {
  return info.subtitles.map((s) => ({
    id: `s${s.index}`,
    codec: s.codec,
    language: s.language,
    title: s.title,
    forced: s.isForced,
    isDefault: s.isDefault,
    external: false,
    text: s.isText,
    source: s.index,
  }));
}

/**
 * Converts subtitle tracks to WebVTT once and caches the result per file. Cue times are
 * media times (not shifted by an HLS session's start offset).
 */
export class SubtitleService {
  private inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly cacheDir: string,
    private readonly ffmpeg: () => FfmpegInfo | null,
  ) {
    mkdirSync(cacheDir, { recursive: true });
  }

  /** Path of the cached .vtt, extracting it first if needed. */
  vtt(fileId: number, input: string, track: SubtitleTrack): Promise<string> {
    const out = join(this.cacheDir, `${fileId}-${track.id}.vtt`);
    if (existsSync(out)) return Promise.resolve(out);
    const key = out;
    let job = this.inflight.get(key);
    if (!job) {
      job = this.extract(typeof track.source === "string" ? track.source : input, typeof track.source === "number" ? track.source : 0, out).finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
    }
    return job;
  }

  /** Drops cached tracks for a file whose content changed. */
  forget(fileId: number) {
    for (const name of readdirSync(this.cacheDir)) if (name.startsWith(`${fileId}-`)) rmSync(join(this.cacheDir, name), { force: true });
  }

  private async extract(input: string, streamIndex: number, out: string): Promise<string> {
    const ff = this.ffmpeg();
    if (!ff) throw new Error("ffmpeg is not installed");
    const tmp = `${out}.tmp`;
    const args = [ff.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
    if (/^https?:/.test(input)) args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10");
    args.push("-i", input, "-map", `0:${streamIndex}`, "-c:s", "webvtt", "-f", "webvtt", tmp);
    const started = Date.now();
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) {
      rmSync(tmp, { force: true });
      throw new Error(redactSecrets(`Subtitle extraction failed: ${stderr.trim().split("\n").pop() ?? code}`));
    }
    renameSync(tmp, out);
    log.info(`Extracted ${basename(out)} in ${Date.now() - started}ms`);
    return out;
  }
}
