import type { Library, FileRow } from "../library";
import { logger } from "../log";
import { probe, type MediaInfo } from "../media/probe";
import type { FfmpegInfo } from "../platform/ffmpeg";
import type { ProgressStore } from "../progress";
import type { Settings } from "../settings";
import { findCandidates, toCandidate, type Candidate } from "../sources/resolver";
import type { TorboxClient } from "../sources/torbox/client";
import { parseTorboxRef } from "../sources/torbox/sync";
import { decide, type ClientCaps } from "./decide";
import { NotReadyError, isInfoHash, type Discovery } from "../sources/discovery";
import { embeddedTracks, findSidecars } from "./subtitles";
import type { EpisodeRef } from "../catalog/service";
import type { SessionManager, SessionTarget, PlaybackSession } from "./sessions";

const log = logger("playback");

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
  /** `url` is set for tracks the server can serve as WebVTT (cue times are media time). */
  subtitleTracks: { id: string; codec: string; language?: string; title?: string; forced: boolean; isDefault: boolean; external: boolean; url: string | null }[];
  chapters: { startMs: number; title?: string }[];
  reasons: string[];
  /** For episodes: what Up Next should offer, and whether it can play right away. */
  nextEpisode: { season: number; episode: number; name: string; stillUrl: string | null; available: boolean } | null;
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
    private readonly discovery: Discovery,
    private readonly findNextEpisode: (showId: number, season: number, episode: number) => Promise<EpisodeRef | null>,
  ) {}

  async play(user: { userId: number; profileId: number }, req: PlayRequest): Promise<PlayResponse> {
    const file = await this.chooseFile(req);

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
        subtitles: [...embeddedTracks(info), ...(file.provider === "local" ? findSidecars(file.ref) : [])],
      });
    } catch (err) {
      throw new PlaybackError(err instanceof Error ? err.message : String(err), 503);
    }

    const next = req.mediaType === "episode" ? await this.findNextEpisode(req.tmdbId, req.season!, req.episode!).catch(() => null) : null;
    const nextInLibrary = next ? findCandidates(this.library, this.settings(), "episode", req.tmdbId, next.season, next.episode) : [];
    if (next) void this.prewarm({ mediaType: "episode", tmdbId: req.tmdbId, season: next.season, episode: next.episode }, nextInLibrary).catch((err) => log.debug("Pre-warm failed", err));

    return {
      sessionId: session.id,
      mode: plan.mode,
      url: direct ? `/api/stream/${session.id}/file` : `/api/stream/${session.id}/stream.m3u8`,
      startOffsetMs: session.startOffsetMs,
      seekToMs: direct ? startMs : 0,
      durationMs: info.durationMs,
      candidate: toCandidate(this.library.get(file.id)!),
      audioTracks: info.audio.map((a) => ({ index: a.index, codec: a.codec, channels: a.channels, language: a.language, title: a.title, selected: a.index === plan.audioStreamIndex })),
      subtitleTracks: session.subtitles.map((t) => ({
        id: t.id,
        codec: t.codec,
        language: t.language,
        title: t.title,
        forced: t.forced,
        isDefault: t.isDefault,
        external: t.external,
        url: t.text ? `/api/stream/${session.id}/subtitles/${t.id}.vtt` : null,
      })),
      chapters: info.chapters,
      reasons: plan.reasons,
      nextEpisode: next ? { ...next, available: nextInLibrary.length > 0 || this.discovery.available } : null,
    };
  }

  /**
   * Gets the next episode ready while this one plays: probe (and fetch a TorBox link for)
   * the file that would play, or warm the scraper cache when it isn't in the library.
   * Never adds anything to TorBox on its own.
   */
  private async prewarm(target: SessionTarget, candidates: Candidate[]) {
    const best = candidates[0];
    if (!best) {
      if (this.discovery.available) await this.discovery.releases(target);
      return;
    }
    const file = this.library.get(best.fileId);
    if (!file || file.probeJson) return;
    const { input } = await this.resolveInput(file);
    await this.probeFile(file, input);
    log.debug(`Pre-warmed S${target.season}E${target.episode}`);
  }

  /**
   * Picks the file to play: the requested candidate, else the best library file, else the
   * best cached release discovery can find (added to TorBox on the fly).
   */
  private async chooseFile(req: PlayRequest): Promise<FileRow> {
    const target = { mediaType: req.mediaType, tmdbId: req.tmdbId, season: req.season, episode: req.episode };
    let hash: string | undefined;
    if (req.candidateId?.startsWith("hash:")) {
      hash = req.candidateId.slice(5).toLowerCase();
      if (!isInfoHash(hash)) throw new PlaybackError("Unknown source", 404);
      // Only hashes already in the library, or ones discovery offered for this exact
      // title, may be added to the owner's TorBox — never an arbitrary torrent.
      if (this.library.byHash(hash).length === 0) {
        if (!this.discovery.available) throw new PlaybackError("Discovery is turned off", 403);
        const offered = (await this.discovery.releases(target)).find((r) => r.hash === hash);
        if (!offered) throw new PlaybackError("Unknown source", 404);
        if (!offered.cached && !this.settings().showUncached) throw new PlaybackError("That release isn't cached on TorBox", 409);
      }
    } else {
      const candidates = findCandidates(this.library, this.settings(), req.mediaType, req.tmdbId, req.season, req.episode);
      const candidate = req.candidateId ? candidates.find((c) => c.id === req.candidateId) : candidates[0];
      if (candidate) return this.library.get(candidate.fileId)!;
      if (req.candidateId) throw new PlaybackError("Unknown source", 404);
      if (this.discovery.available) hash = (await this.discovery.bestCached(target))?.hash;
      if (!hash) throw new PlaybackError("No source available for this title", 404);
    }
    const result = await this.discovery.acquire(target, hash);
    if (result.status === "downloading") throw new NotReadyError(result);
    return this.library.get(result.fileId)!;
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
      // Details (already redacted) go to the log; clients get a generic message.
      log.warn(`Probe failed for file ${file.id}`, err);
      throw new PlaybackError("Could not read this file", 502);
    }
  }
}
