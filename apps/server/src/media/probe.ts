import { redactSecrets } from "../log";

export interface VideoTrack {
  index: number;
  codec: string;
  profile?: string;
  width: number;
  height: number;
  fps?: number;
  bitDepth?: number;
  hdr: "dv" | "hdr10" | "hlg" | null;
  dvProfile?: number;
}

export interface AudioTrack {
  index: number;
  codec: string;
  channels: number;
  language?: string;
  title?: string;
  isDefault: boolean;
}

export interface SubtitleTrack {
  index: number;
  codec: string;
  language?: string;
  title?: string;
  isDefault: boolean;
  isForced: boolean;
  /** Text formats can become WebVTT; bitmap ones (PGS, VobSub) need burn-in. */
  isText: boolean;
}

export interface MediaInfo {
  container: string;
  durationMs: number;
  bitrate?: number;
  video?: VideoTrack;
  audio: AudioTrack[];
  subtitles: SubtitleTrack[];
  chapters: { startMs: number; title?: string }[];
}

const TEXT_SUBTITLES = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);

/** `networkTimeoutMs` bounds each read from a URL (a stalled CDN fails fast instead of hanging). */
export async function probe(ffprobe: string, input: string, timeoutMs = 45_000, networkTimeoutMs = 15_000): Promise<MediaInfo> {
  const args = [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters"];
  if (/^https?:/.test(input)) args.push("-rw_timeout", String(networkTimeoutMs * 1000));
  args.push(input);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(redactSecrets(`ffprobe failed (${code}): ${err.trim().split("\n").pop() ?? "unknown error"}`));
  return summarize(JSON.parse(out), input);
}

interface RawStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  bits_per_raw_sample?: string;
  pix_fmt?: string;
  color_transfer?: string;
  channels?: number;
  disposition?: { default?: number; forced?: number; attached_pic?: number };
  tags?: { language?: string; title?: string };
  side_data_list?: { side_data_type?: string; dv_profile?: number }[];
}

export function summarize(raw: { format?: { format_name?: string; duration?: string; bit_rate?: string }; streams?: RawStream[]; chapters?: { start_time: string; tags?: { title?: string } }[] }, input = ""): MediaInfo {
  const streams = raw.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const lang = (s: RawStream) => (s.tags?.language && s.tags.language !== "und" ? s.tags.language : undefined);

  let video: VideoTrack | undefined;
  if (v) {
    const dv = v.side_data_list?.find((d) => d.side_data_type?.includes("DOVI"));
    const hdr = dv ? "dv" : v.color_transfer === "smpte2084" ? "hdr10" : v.color_transfer === "arib-std-b67" ? "hlg" : null;
    const [num, den] = (v.avg_frame_rate ?? "0/1").split("/").map(Number);
    video = {
      index: v.index,
      codec: v.codec_name ?? "unknown",
      profile: v.profile,
      width: v.width ?? 0,
      height: v.height ?? 0,
      fps: num && den ? Math.round((num / den) * 1000) / 1000 : undefined,
      bitDepth: v.bits_per_raw_sample ? Number(v.bits_per_raw_sample) : v.pix_fmt?.includes("10") ? 10 : 8,
      hdr,
      dvProfile: dv?.dv_profile,
    };
  }

  return {
    container: containerOf(raw.format?.format_name ?? "", input),
    durationMs: Math.round(Number(raw.format?.duration ?? 0) * 1000),
    bitrate: raw.format?.bit_rate ? Number(raw.format.bit_rate) : undefined,
    video,
    audio: streams
      .filter((s) => s.codec_type === "audio")
      .map((s) => ({ index: s.index, codec: s.codec_name ?? "unknown", channels: s.channels ?? 2, language: lang(s), title: s.tags?.title, isDefault: s.disposition?.default === 1 })),
    subtitles: streams
      .filter((s) => s.codec_type === "subtitle")
      .map((s) => ({
        index: s.index,
        codec: s.codec_name ?? "unknown",
        language: lang(s),
        title: s.tags?.title,
        isDefault: s.disposition?.default === 1,
        isForced: s.disposition?.forced === 1,
        isText: TEXT_SUBTITLES.has(s.codec_name ?? ""),
      })),
    chapters: (raw.chapters ?? []).map((c) => ({ startMs: Math.round(Number(c.start_time) * 1000), title: c.tags?.title })),
  };
}

function containerOf(formatName: string, input: string): string {
  if (formatName.includes("matroska")) return input.toLowerCase().split("?")[0]!.endsWith(".webm") ? "webm" : "mkv";
  if (formatName.includes("mp4") || formatName.includes("mov")) {
    return /\.mov(\?|$)/i.test(input) ? "mov" : "mp4";
  }
  if (formatName.includes("mpegts")) return "ts";
  return formatName.split(",")[0] ?? "unknown";
}
