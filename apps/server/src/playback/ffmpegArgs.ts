import type { MediaInfo } from "../media/probe";
import type { PlaybackPlan } from "./decide";

export const SEGMENT_SECONDS = 6;

export interface HlsArgsInput {
  ffmpeg: string;
  input: string;
  startSeconds: number;
  plan: PlaybackPlan;
  info: MediaInfo;
  outDir: string;
  hwEncoder?: "h264_videotoolbox" | "h264_vaapi" | "h264_qsv";
}

export function buildHlsArgs({ ffmpeg, input, startSeconds, plan, info, outDir, hwEncoder }: HlsArgsInput): string[] {
  const args = [ffmpeg, "-hide_banner", "-loglevel", "warning", "-nostdin", "-y"];
  if (/^https?:/.test(input)) {
    args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "10", "-rw_timeout", "30000000");
  }
  if (startSeconds > 0) args.push("-ss", startSeconds.toFixed(3));
  args.push("-i", input);

  args.push("-map", plan.videoStreamIndex !== undefined ? `0:${plan.videoStreamIndex}` : "0:v:0?");
  if (plan.audioStreamIndex !== undefined) args.push("-map", `0:${plan.audioStreamIndex}`);

  const v = info.video;
  if (plan.video === "copy") {
    args.push("-c:v", "copy");
    if (v?.codec === "hevc") args.push("-tag:v", "hvc1");
    if (plan.stripDolbyVision) args.push("-bsf:v", "dovi_rbsp=strip=1");
  } else {
    const height = Math.min(plan.targetHeight ?? v?.height ?? 1080, v?.height ?? 1080);
    const bitrate = height >= 2160 ? 20_000 : height >= 1080 ? 8_000 : height >= 720 ? 4_000 : 2_000;
    const filters = [`scale=-2:${height}`];
    if (hwEncoder === "h264_videotoolbox") {
      args.push("-c:v", "h264_videotoolbox", "-b:v", `${bitrate}k`, "-maxrate", `${Math.round(bitrate * 1.5)}k`, "-bufsize", `${bitrate * 2}k`, "-profile:v", "high");
      filters.push("format=yuv420p");
    } else if (hwEncoder === "h264_vaapi") {
      args.push("-vaapi_device", "/dev/dri/renderD128", "-c:v", "h264_vaapi", "-b:v", `${bitrate}k`);
      filters.push("format=nv12", "hwupload");
    } else if (hwEncoder === "h264_qsv") {
      args.push("-c:v", "h264_qsv", "-b:v", `${bitrate}k`, "-preset", "veryfast");
      filters.push("format=nv12");
    } else {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-maxrate", `${bitrate}k`, "-bufsize", `${bitrate * 2}k`, "-profile:v", "high");
      filters.push("format=yuv420p");
    }
    args.push("-vf", filters.join(","));
    // Fixed keyframe cadence gives segments of exactly SEGMENT_SECONDS.
    args.push("-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_SECONDS})`);
  }

  const audio = info.audio.find((a) => a.index === plan.audioStreamIndex);
  if (plan.audio === "copy") args.push("-c:a", "copy");
  else {
    if (plan.audio === "eac3") args.push("-c:a", "eac3", "-b:a", "640k", "-ac", String(Math.min(audio?.channels ?? 6, 6)));
    else args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
    // Some releases start their audio well after the video (15s into one WEBRip). Fill that
    // gap with silence from 0 so the first segment, and the init segment's audio
    // description, exist; sync is kept because the silence covers exactly the gap.
    args.push("-af", "aresample=async=1:first_pts=0");
  }
  // Wait for every stream rather than writing a segment without the late one (default 10s).
  args.push("-max_interleave_delta", "0");

  args.push(
    "-sn",
    "-dn",
    "-map_chapters",
    "-1",
    "-f",
    "hls",
    "-hls_time",
    String(SEGMENT_SECONDS),
    "-hls_playlist_type",
    "event",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    `${outDir}/seg%05d.m4s`,
    "-hls_flags",
    "independent_segments+temp_file",
    "-start_number",
    "0",
    `${outDir}/stream.m3u8`,
  );
  return args;
}
