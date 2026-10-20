import type { Library, FileRow } from "../library";
import { probe, type MediaInfo } from "../media/probe";
import type { FfmpegInfo } from "../platform/ffmpeg";
import type { ProgressStore } from "../progress";
import type { Settings } from "../settings";
import { findCandidates, toCandidate, type Candidate } from "../sources/resolver";
import type { TorboxClient } from "../sources/torbox/client";
import { parseTorboxRef } from "../sources/torbox/sync";
import { decide, type ClientCaps } from "./decide";
import type { SessionManager, SessionTarget, PlaybackSession } from "./sessions";

export class PlaybackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PlayRequest extends SessionTarget {
  candidateId?: string;
  /** Start position; omitted means resume from saved progress. */
  startMs?: number;
  audioStreamIndex?: number;
  caps: ClientCaps;
}

export interface PlayResponse {
  sessionId: string;
  mode: "direct" | "remux" | "transcode";
  /** Relative to the server's base URL. */
  url: string;
  /** Media time at which the stream's t=0 sits (HLS starts at the resume point). */
  startOffsetMs: number;
  /** Where the client should seek after loading, in stream time. */
  seekToMs: number;
  durationMs: number;
  candidate: Candidate;
  audioTracks: { index: number; codec: string; channels: number; language?: string; title?: string; selected: boolean }[];
  subtitleTracks: { index: number; codec: string; language?: string; title?: string; forced: boolean; text: boolean }[];
  chapters: { startMs: number; title?: string }[];
  reasons: string[];
}

const LINK_TTL_MS = 30 * 60_000;

export class PlaybackService {
  private links = new Map<number, { url: string; at: number }>();

  constructor(
    private readonly library: Library,
    private readonly sessions: SessionManager,
    private readonly progress: ProgressStore,
    private readonly settings: () => Settings,
    private readonly ffmpeg: () => FfmpegInfo | null,
    private readonly torbox: () => TorboxClient | null,
  ) {}

  async play(user: { userId: number; profileId: number }, req: PlayRequest): Promise<PlayResponse> {
    const candidates = findCandidates(this.library, this.settings(), req.mediaType, req.tmdbId, req.season, req.episode);
    if (candidates.length === 0) throw new PlaybackError("No source available for this title", 404);
    const candidate = req.candidateId ? candidates.find((c) => c.id === req.candidateId) : candidates[0];
    if (!candidate) throw new PlaybackError("Unknown source", 404);
    const file = this.library.get(candidate.fileId)!;

    const { input, inputKind } = await this.resolveInput(file);
    const info = await this.probeFile(file, input);
    const plan = decide(info, req.caps, req.audioStreamIndex, this.settings().language);

    let startMs = req.startMs;
    if (startMs === undefined) {
      const saved = this.progress.get(user.profileId, req);
      startMs = saved && !saved.completed ? saved.positionMs : 0;
    }
    startMs = Math.max(0, Math.min(startMs, Math.max(0, info.durationMs - 10_000)));

    this.sessions.stopForTarget(user.userId, req);
    const direct = plan.mode === "direct";
    let session: PlaybackSession;
    try {
      session = this.sessions.create({
        profileId: user.profileId,
        userId: user.userId,
        fileId: file.id,
        target: { mediaType: req.mediaType, tmdbId: req.tmdbId, season: req.season, episode: req.episode },
        plan,
        info,
        input,
        inputKind,
        // Direct play seeks client-side; HLS starts encoding at the resume point.
        startOffsetMs: direct ? 0 : startMs,
      });
    } catch (err) {
      throw new PlaybackError(err instanceof Error ? err.message : String(err), 503);
    }

    return {
      sessionId: session.id,
      mode: plan.mode,
      url: direct ? `/api/stream/${session.id}/file` : `/api/stream/${session.id}/stream.m3u8`,
      startOffsetMs: session.startOffsetMs,
      seekToMs: direct ? startMs : 0,
      durationMs: info.durationMs,
      candidate: toCandidate(this.library.get(file.id)!),
      audioTracks: info.audio.map((a) => ({ index: a.index, codec: a.codec, channels: a.channels, language: a.language, title: a.title, selected: a.index === plan.audioStreamIndex })),
      subtitleTracks: info.subtitles.map((s) => ({ index: s.index, codec: s.codec, language: s.language, title: s.title, forced: s.isForced, text: s.isText })),
      chapters: info.chapters,
      reasons: plan.reasons,
    };
  }

  /** A fresh TorBox link for a session whose cached one expired. */
  async refreshLink(session: PlaybackSession): Promise<string> {
    this.links.delete(session.fileId);
    const file = this.library.get(session.fileId);
    if (!file) throw new PlaybackError("File no longer exists", 410);
    const { input } = await this.resolveInput(file);
    session.input = input;
    return input;
  }

  private async resolveInput(file: FileRow): Promise<{ input: string; inputKind: "path" | "url" }> {
    if (file.provider === "local") return { input: file.ref, inputKind: "path" };
    const cached = this.links.get(file.id);
    if (cached && Date.now() - cached.at < LINK_TTL_MS) return { input: cached.url, inputKind: "url" };
    const client = this.torbox();
    if (!client) throw new PlaybackError("TorBox is not configured", 503);
    const { kind, itemId, fileId } = parseTorboxRef(file.ref);
    const url = await client.requestLink(kind, itemId, fileId);
    this.links.set(file.id, { url, at: Date.now() });
    return { input: url, inputKind: "url" };
  }

  private async probeFile(file: FileRow, input: string): Promise<MediaInfo> {
    if (file.probeJson) return JSON.parse(file.probeJson) as MediaInfo;
    const ff = this.ffmpeg();
    if (!ff) throw new PlaybackError("ffmpeg/ffprobe is not installed on the server", 503);
    try {
      const info = await probe(ff.ffprobe, input);
      this.library.saveProbe(file.id, info);
      return info;
    } catch (err) {
      throw new PlaybackError(`Could not read media: ${err instanceof Error ? err.message : err}`, 502);
    }
  }
}
