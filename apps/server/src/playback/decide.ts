import { z } from "zod";
import type { AudioTrack, MediaInfo } from "../media/probe";

export const capsSchema = z.object({
  containers: z.array(z.string()).default(["mp4", "mov", "m4v"]),
  videoCodecs: z.array(z.string()).default(["h264", "hevc"]),
  audioCodecs: z.array(z.string()).default(["aac", "ac3", "eac3", "mp3", "alac", "flac"]),
  maxHeight: z.number().int().default(2160),
  hdr: z.array(z.enum(["hdr10", "hlg", "dv"])).default(["hdr10", "hlg", "dv"]),
  /** Dolby Vision profiles the device decodes natively. Apple devices handle 5 and 8. */
  dvProfiles: z.array(z.number().int()).default([5, 8]),
});
export type ClientCaps = z.infer<typeof capsSchema>;
export const DEFAULT_CAPS: ClientCaps = capsSchema.parse({});

export interface PlaybackPlan {
  mode: "direct" | "remux" | "transcode";
  video: "copy" | "transcode";
  audio: "copy" | "aac" | "eac3";
  audioStreamIndex?: number;
  videoStreamIndex?: number;
  /** Drop the Dolby Vision enhancement layer (profile 7) and play the HDR10 base. */
  stripDolbyVision: boolean;
  targetHeight?: number;
  reasons: string[];
}

export function pickAudio(info: MediaInfo, requested?: number, preferredLanguage?: string): AudioTrack | undefined {
  if (requested !== undefined) {
    const track = info.audio.find((a) => a.index === requested);
    if (track) return track;
  }
  if (preferredLanguage) {
    const lang = preferredLanguage.slice(0, 2).toLowerCase();
    const match = info.audio.find((a) => a.language?.toLowerCase().startsWith(lang));
    if (match) return match;
  }
  return info.audio.find((a) => a.isDefault) ?? info.audio[0];
}

export function decide(info: MediaInfo, caps: ClientCaps, audioIndex?: number, preferredLanguage?: string): PlaybackPlan {
  const reasons: string[] = [];
  const v = info.video;
  const audio = pickAudio(info, audioIndex, preferredLanguage);

  let video: PlaybackPlan["video"] = "copy";
  let stripDolbyVision = false;
  let targetHeight: number | undefined;

  if (!v) {
    reasons.push("no video stream");
  } else {
    if (!caps.videoCodecs.includes(v.codec)) {
      video = "transcode";
      reasons.push(`video codec ${v.codec} unsupported`);
    } else if (v.codec === "h264" && (v.bitDepth ?? 8) > 8) {
      video = "transcode";
      reasons.push("10-bit H.264 unsupported");
    }
    if (v.height > caps.maxHeight) {
      video = "transcode";
      targetHeight = caps.maxHeight;
      reasons.push(`${v.height}p exceeds ${caps.maxHeight}p`);
    }
    if (v.hdr === "dv" && video === "copy") {
      const profile = v.dvProfile ?? 0;
      if (profile === 7) {
        stripDolbyVision = true;
        reasons.push("Dolby Vision profile 7 → HDR10 base layer");
      } else if (!caps.dvProfiles.includes(profile) && profile === 5) {
        // Profile 5 has no HDR10 fallback; it must be decoded and re-encoded.
        video = "transcode";
        reasons.push("Dolby Vision profile 5 unsupported by client");
      }
    }
  }

  let audioAction: PlaybackPlan["audio"] = "copy";
  if (audio && !caps.audioCodecs.includes(audio.codec)) {
    audioAction = audio.channels > 2 && caps.audioCodecs.includes("eac3") ? "eac3" : "aac";
    reasons.push(`audio ${audio.codec} → ${audioAction}`);
  }

  const containerOk = caps.containers.includes(info.container);
  // Direct play can't pick a non-default track reliably on every client, so a requested
  // non-default track goes through HLS where exactly one audio track is muxed.
  const audioIsDefault = !audio || audio === (info.audio.find((a) => a.isDefault) ?? info.audio[0]);
  let mode: PlaybackPlan["mode"];
  if (video === "transcode") mode = "transcode";
  else if (containerOk && audioAction === "copy" && !stripDolbyVision && audioIsDefault) mode = "direct";
  else {
    mode = "remux";
    if (!containerOk) reasons.push(`container ${info.container} → HLS`);
  }

  // Copying Dolby audio into HLS fMP4 needs its first packet to describe the track; when a
  // file stores audio well after the video (common in MKV WEBRips) the init segment gets an
  // empty audio track and Apple's player refuses the stream. Re-encoding knows it up front.
  if (mode !== "direct" && audioAction === "copy" && audio && (audio.codec === "eac3" || audio.codec === "ac3")) {
    audioAction = "eac3";
    reasons.push(`audio ${audio.codec} re-encoded for HLS`);
  }

  return { mode, video, audio: audioAction, audioStreamIndex: audio?.index, videoStreamIndex: v?.index, stripDolbyVision, targetHeight, reasons };
}
