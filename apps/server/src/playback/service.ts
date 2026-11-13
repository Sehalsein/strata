import type { Library, FileRow } from "../library";
import { logger } from "../log";
import { probe, type MediaInfo } from "../media/probe";
import type { FfmpegInfo } from "../platform/ffmpeg";
import type { ProgressStore } from "../progress";
import type { Settings } from "../settings";
import { findCandidates, toCandidate, type Candidate } from "../sources/resolver";
import type { TorboxClient } from "../sources/torbox/client";
import { parseTorboxRef } from "../sources/torbox/sync";
import { decide, type ClientCaps, type PlaybackPlan } from "./decide";
import { NoPlayableFileError, NotReadyError, isInfoHash, type Discovery } from "../sources/discovery";
import { embeddedTracks, findSidecars } from "./subtitles";
import type { EpisodeRef } from "../catalog/service";
import { targetRef, type TitleRef } from "../catalog/ref";
import type { SessionManager, SessionTarget, PlaybackSession } from "./sessions";
import { runtime } from "#runtime";

const log = logger("playback");

export class PlaybackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Just the title of a request (no play options), as sessions and discovery keep it. */
const targetOf = (t: SessionTarget): SessionTarget => ({ source: t.source, mediaType: t.mediaType, titleId: t.titleId, season: t.season, episode: t.episode });

export interface PlayRequest extends SessionTarget {
  candidateId?: string;
  /** Start position; omitted means resume from saved progress. */
  startMs?: number;
  audioStreamIndex?: number;
  /** Without a chosen source, prefer one no taller than this (the app on cellular data). */
  preferMaxHeight?: number;
  caps: ClientCaps;
}

/** What the app downloads to watch offline: the file's link and how to play it on the device. */
export interface DownloadResponse {
  fileId: number;
  /** The TorBox link, or `/api/files/:id/content` for a file on this server's disk. */
  url: string;
  mode: "direct" | "device";
  remux: PlayResponse["remux"];
  durationMs: number;
  candidate: Candidate;
  audioTracks: PlayResponse["audioTracks"];
  /** Embedded text tracks only: the app reads them from the file. */
  subtitleTracks: PlayResponse["subtitleTracks"];
  chapters: PlayResponse["chapters"];
}

export interface PlayResponse {
  sessionId: string;
  mode: "direct" | "device" | "remux" | "transcode";
  /**
   * Relative to the server's base URL, or for TorBox files in direct and device modes,
   * the absolute TorBox link: the app fetches the file itself and nothing streams
   * through here.
   */
  url: string;
  /** Device mode: what the app does as it repackages the file. */
  remux: { audio: PlaybackPlan["audio"]; audioStreamIndex?: number; videoStreamIndex?: number; stripDolbyVision: boolean } | null;
  /** Media time at which the stream's t=0 sits (HLS starts at the resume point). */
  startOffsetMs: number;
  /** Where the client should seek after loading, in stream time. */
  seekToMs: number;
  durationMs: number;
  candidate: Candidate;
  audioTracks: { index: number; codec: string; channels: number; language?: string; title?: string; selected: boolean }[];
  /**
   * `url` is set for tracks the server can serve as WebVTT (cue times are media time).
   * In device mode embedded text tracks have none: the app reads them from the stream
   * (`embedded`, at `streamIndex`), so the server never reads the whole file for them.
   */
  subtitleTracks: { id: string; codec: string; language?: string; title?: string; forced: boolean; isDefault: boolean; external: boolean; url: string | null; embedded?: boolean; streamIndex?: number }[];
  chapters: { startMs: number; title?: string }[];
  reasons: string[];
  /** For episodes: what Up Next should offer, and whether it can play right away. */
  nextEpisode: { season: number; episode: number; name: string; stillUrl: string | null; available: boolean } | null;
}

const LINK_TTL_MS = 30 * 60_000;
/** Ready releases Play tries in turn when the library has nothing. */
const AUTO_TRIES = 3;
/** A source the app named that isn't there any more. */
const GONE = "That source isn't available any more. Pick another one.";
const PROBE_FAILURE_TTL_MS = 60_000;

/** A read timeout or dropped connection, as opposed to a file ffprobe can't make sense of. */
function isNetworkStall(err: unknown): boolean {
  return /timed out|connection|reset by peer|I\/O error|Server returned 5\d\d|Network is unreachable/i.test(String(err));
}

/**
 * TorBox files never stream through the server: the app plays them straight from TorBox
 * (direct, or repackaged on the device). One the app can't play that way, the server
 * won't remux or transcode either, so a cloud-hosted server serves no video. Files on the
 * server's own disk still stream from it, as their bytes are only here.
 */
export function refuseServerStream(plan: PlaybackPlan, inputKind: "path" | "url", caps: ClientCaps): void {
  if (playsAsIs(plan, inputKind)) return;
  if (!caps.deviceRemux) throw new PlaybackError("Update the Strata app to play this.", 422);
  throw new PlaybackError(cantPlayHere(plan), 422);
}

/** Whether a plan needs nothing from the server it can't give (TorBox files never stream through it). */
const playsAsIs = (plan: PlaybackPlan, inputKind: "path" | "url") => inputKind !== "url" || plan.mode === "direct" || plan.mode === "device";

/** A download plays on the device as it is or repackaged there, never through the server. */
export function playsOnDevice(plan: PlaybackPlan): "direct" | "device" {
  if (plan.mode === "direct" || plan.mode === "device") return plan.mode;
  throw new PlaybackError(cantPlayHere(plan), 422);
}

const resolutionName = (height: number) => (height >= 2000 ? "4K" : `${height}p`);

/**
 * Why a copy won't play on this device, in words: only what the device can't do (audio
 * and containers it fixes itself).
 */
export function cantPlayHere(plan: PlaybackPlan): string {
  const why = plan.reasons.flatMap((reason) => {
    let m: RegExpExecArray | null;
    if ((m = /^(\d+)p exceeds (\d+)p$/.exec(reason))) return [`it's ${resolutionName(Number(m[1]))}, and this device plays up to ${resolutionName(Number(m[2]))}`];
    if ((m = /^video codec (\S+) unsupported$/.exec(reason))) return [`this device can't decode its ${m[1]!.toUpperCase()} video`];
    if (reason === "10-bit H.264 unsupported") return ["this device can't decode its 10-bit H.264 video"];
    if (reason.startsWith("Dolby Vision profile 5")) return ["its Dolby Vision needs an HDR display"];
    if (reason === "no video stream") return ["it has no video"];
    return [];
  });
  return why.length ? `This copy won't play here: ${why.join(", and ")}. Choose another source.` : "This copy won't play on this device. Choose another source.";
}

/** The server has no media info for this TorBox file: the app reads it from `url` and sends it. */
export class NeedsProbeError extends Error {
  constructor(
    readonly fileId: number,
    readonly url: string,
  ) {
    super("The app needs to read this file's details");
  }
}

export class PlaybackService {
  private links = new Map<number, { url: string; at: number }>();
  private probing = new Map<number, Promise<MediaInfo>>();
  private probeFailures = new Map<number, number>();

  constructor(
    private readonly library: Library,
    private readonly sessions: SessionManager,
    private readonly progress: ProgressStore,
    private readonly settings: () => Settings,
    private readonly ffmpeg: () => FfmpegInfo | null,
    private readonly torbox: () => TorboxClient | null,
    private readonly discovery: Discovery,
    private readonly findNextEpisode: (show: TitleRef, season: number, episode: number) => Promise<EpisodeRef | null>,
    /** Told when a TorBox torrent is played, so housekeeping keeps it. */
    private readonly onPlayedTorrent: (torrentId: number) => void = () => {},
  ) {}

  async play(user: { userId: string }, req: PlayRequest): Promise<PlayResponse> {
    // Started now so the (possibly uncached) season lookup overlaps the probe and link.
    const nextLookup = req.mediaType === "episode" ? this.findNextEpisode(targetRef(req), req.season!, req.episode!).catch(() => null) : Promise.resolve(null);
    let prepared = await this.prepare(req);
    // Picked for the person (not chosen): a copy this device can't play gives way to the
    // next library copy that it can, among those whose details are already known.
    if (!req.candidateId && !playsAsIs(prepared.plan, prepared.inputKind)) {
      const others = (await findCandidates(this.library, this.settings(), targetOf(req))).filter((c) => c.fileId !== prepared.file.id).slice(0, 5);
      for (const other of others) {
        const next = await this.prepare({ ...req, candidateId: other.id }).catch((err) => {
          if (err instanceof NeedsProbeError) return null;
          throw err;
        });
        if (next && playsAsIs(next.plan, next.inputKind)) {
          prepared = next;
          break;
        }
      }
    }
    const { file, info, input, inputKind, plan, remux, audioTracks, candidate } = prepared;
    refuseServerStream(plan, inputKind, req.caps);

    let startMs = req.startMs;
    if (startMs === undefined) {
      const saved = await this.progress.get(user.userId, req);
      startMs = saved && !saved.completed ? saved.positionMs : 0;
    }
    startMs = Math.max(0, Math.min(startMs, Math.max(0, info.durationMs - 10_000)));

    if (file.provider === "torbox") {
      const ref = parseTorboxRef(file.ref);
      if (ref.kind === "torrents") this.onPlayedTorrent(ref.itemId);
    }

    await this.sessions.stopForTarget(user.userId, req);
    // Direct and device play start at t=0 and seek on the client; HLS encodes from the resume point.
    const direct = plan.mode === "direct" || plan.mode === "device";
    let session: PlaybackSession;
    try {
      session = await this.sessions.create({
        organizationId: this.library.organizationId,
        userId: user.userId,
        fileId: file.id,
        target: targetOf(req),
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

    const next = await nextLookup;
    const nextTarget: SessionTarget | null = next ? { source: req.source, mediaType: "episode", titleId: req.titleId, season: next.season, episode: next.episode } : null;
    const nextInLibrary = nextTarget ? await findCandidates(this.library, this.settings(), nextTarget) : [];
    if (nextTarget) runtime.background(this.prewarm(nextTarget, nextInLibrary).catch((err) => log.debug("Pre-warm failed", err)));

    return {
      sessionId: session.id,
      mode: plan.mode,
      url: direct ? this.handOff(session) : `/api/stream/${session.id}/stream.m3u8`,
      remux,
      startOffsetMs: session.startOffsetMs,
      seekToMs: direct ? startMs : 0,
      durationMs: info.durationMs,
      candidate,
      audioTracks,
      subtitleTracks: session.subtitles.map((t) => ({
        id: t.id,
        codec: t.codec,
        language: t.language,
        title: t.title,
        forced: t.forced,
        isDefault: t.isDefault,
        external: t.external,
        ...(plan.mode === "device" && !t.external
          ? { url: null, embedded: t.text, streamIndex: typeof t.source === "number" ? t.source : undefined }
          : { url: t.text ? `/api/stream/${session.id}/subtitles/${t.id}.vtt` : null }),
      })),
      chapters: info.chapters,
      reasons: plan.reasons,
      nextEpisode: next ? { ...next, available: nextInLibrary.length > 0 || this.discovery.available } : null,
    };
  }

  /**
   * A file to download and watch offline, chosen like `play` (without a session): it must
   * play on the device as it is or repackaged there.
   */
  async prepareDownload(req: Omit<PlayRequest, "startMs">): Promise<DownloadResponse> {
    const { file, info, input, inputKind, plan, remux, audioTracks, candidate } = await this.prepare(req);
    return {
      fileId: file.id,
      url: inputKind === "url" ? input : `/api/files/${file.id}/content`,
      mode: playsOnDevice(plan),
      remux,
      durationMs: info.durationMs,
      candidate,
      audioTracks,
      // Read from the file as it plays: text, and pictures (embedded false) the app draws.
      subtitleTracks: embeddedTracks(info)
        .filter((t) => typeof t.source === "number")
        .map((t) => ({ id: t.id, codec: t.codec, language: t.language, title: t.title, forced: t.forced, isDefault: t.isDefault, external: false, url: null, embedded: t.text, streamIndex: t.source as number })),
      chapters: info.chapters,
    };
  }

  /**
   * Gets a title ready to play on this device, for play and download alike: chooses the
   * file, makes sure it's reachable (a fresh TorBox link) and its media known (or throws
   * NeedsProbeError for the app to read it), and plans how it plays. The caller then
   * refuses what it can't use: refuseServerStream to play, playsOnDevice to download.
   */
  private async prepare(req: Omit<PlayRequest, "startMs">) {
    const file = await this.chooseFile(req);
    const first = await this.resolveInput(file);
    const info = await this.probeFile(file, first.input);
    // The probe may have swapped a stalled TorBox link for a fresh one.
    const { input, inputKind } = await this.resolveInput(file);
    const plan = decide(info, req.caps, req.audioStreamIndex, this.settings().language);
    return {
      file,
      info,
      input,
      inputKind,
      plan,
      remux:
        plan.mode === "device"
          ? { audio: plan.audio, audioStreamIndex: plan.audioStreamIndex, videoStreamIndex: plan.videoStreamIndex, stripDolbyVision: plan.stripDolbyVision }
          : null,
      audioTracks: info.audio.map((a) => ({ index: a.index, codec: a.codec, channels: a.channels, language: a.language, title: a.title, selected: a.index === plan.audioStreamIndex })),
      candidate: toCandidate((await this.library.get(file.id))!),
    };
  }

  /** A fresh link to a library file (a download whose link expired), or null for a file on disk. */
  async fileLink(fileId: number): Promise<string | null> {
    const file = await this.library.get(fileId);
    if (!file) throw new PlaybackError("That file is gone from the library. Pick another source.", 410);
    if (file.provider === "local") return null;
    this.links.delete(file.id);
    return (await this.resolveInput(file)).input;
  }

  /** The path of a library file on this server's disk (downloads of local media). */
  async localPath(fileId: number): Promise<string | null> {
    const file = await this.library.get(fileId);
    return file?.provider === "local" ? file.ref : null;
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
    const file = await this.library.get(best.fileId);
    // Without ffprobe the app reads the next file when it gets there.
    if (!file || file.probeJson || !this.ffmpeg()) return;
    const { input } = await this.resolveInput(file);
    // Background work: no retry, so a bad file can't cost a second probe.
    await this.probeFile(file, input, { allowRetry: false });
    log.debug(`Pre-warmed S${target.season}E${target.episode}`);
  }

  /**
   * Picks the file to play: the requested candidate, else the best library file, else the
   * best cached release discovery can find (added to TorBox on the fly).
   */
  private async chooseFile(req: PlayRequest): Promise<FileRow> {
    const target = targetOf(req);
    if (req.candidateId?.startsWith("hash:")) {
      const hash = req.candidateId.slice(5).toLowerCase();
      if (!isInfoHash(hash)) throw new PlaybackError(GONE, 404);
      // Only hashes already in the library, or ones discovery offered for this exact
      // title, may be added to the owner's TorBox — never an arbitrary torrent.
      const inLibraryForTarget = (await this.library.byHash(hash)).some((r) => r.source === req.source && r.mediaType === req.mediaType && r.titleId === req.titleId && (req.mediaType === "movie" || (r.season === req.season && r.episode === req.episode)));
      if (!inLibraryForTarget) {
        if (!this.discovery.available) throw new PlaybackError("Looking beyond the library is turned off on this server.", 403);
        const offered = (await this.discovery.releases(target)).find((r) => r.hash === hash);
        if (!offered) throw new PlaybackError(GONE, 404);
        if (!offered.cached && !this.settings().showUncached) throw new PlaybackError("That copy isn't ready on TorBox yet. Pick another source.", 409);
      }
      try {
        return await this.acquired(target, hash);
      } catch (err) {
        if (err instanceof NoPlayableFileError) throw new PlaybackError("That copy doesn't have this in it. Pick another source.", 422);
        throw err;
      }
    }
    const candidates = await findCandidates(this.library, this.settings(), target);
    const limit = req.preferMaxHeight;
    const candidate = req.candidateId
      ? candidates.find((c) => c.id === req.candidateId)
      : ((limit ? candidates.find((c) => c.resolution !== undefined && c.resolution <= limit) : undefined) ?? candidates[0]);
    if (candidate) return (await this.library.get(candidate.fileId))!;
    if (req.candidateId) throw new PlaybackError(GONE, 404);
    // Nothing in the library: the best ready releases, in turn, past any that turn out
    // not to have it (a pack of other seasons, say).
    const releases = this.discovery.available ? (await this.discovery.cachedReleases(target)).slice(0, AUTO_TRIES) : [];
    for (const release of releases) {
      try {
        return await this.acquired(target, release.hash);
      } catch (err) {
        if (!(err instanceof NoPlayableFileError)) throw err;
        log.info(`${release.title} has no file for this; trying the next release`);
      }
    }
    throw new PlaybackError(
      releases.length
        ? "None of the ready copies had this in it. Sources can look further."
        : "There's no copy of this to play yet: it isn't in your library, and nothing ready turned up. Sources can look further.",
      404,
    );
  }

  /** `discovery.acquire`, as playback's answers: downloading is "not ready yet", and a failure says so plainly. */
  private async acquired(target: SessionTarget, hash: string): Promise<FileRow> {
    let result;
    try {
      result = await this.discovery.acquire(target, hash);
    } catch (err) {
      if (err instanceof NoPlayableFileError || err instanceof PlaybackError) throw err;
      log.warn("Getting a release ready failed", err);
      throw new PlaybackError("TorBox couldn't get this ready just now. Try again, or pick another source.", 502);
    }
    if (result.status === "downloading") throw new NotReadyError(result);
    return (await this.library.get(result.fileId))!;
  }


  /**
   * Where the app fetches a direct or device-mode file: the TorBox link itself, so the
   * bytes never pass through here. TorBox's links carry the account key (`token=`); they
   * go to the household's own apps only. Files on this server's disk are served by
   * `/api/stream/:sid/file`.
   */
  handOff(session: PlaybackSession): string {
    return session.inputKind === "url" ? session.input : `/api/stream/${session.id}/file`;
  }

  /** A fresh TorBox link for a session whose cached one expired. */
  async refreshLink(session: PlaybackSession): Promise<string> {
    this.links.delete(session.fileId);
    const file = await this.library.get(session.fileId);
    if (!file) throw new PlaybackError("That file is gone from the library. Pick another source.", 410);
    const { input } = await this.resolveInput(file);
    await this.sessions.updateLink(session, input);
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

  private async probeFile(file: FileRow, input: string, opts: { allowRetry?: boolean } = {}): Promise<MediaInfo> {
    if (file.probeJson) return JSON.parse(file.probeJson) as MediaInfo;
    const failedAt = this.probeFailures.get(file.id);
    if (failedAt && Date.now() - failedAt < PROBE_FAILURE_TTL_MS) throw this.probeError(file);
    // Concurrent plays and pre-warms of one file share a single probe.
    let pending = this.probing.get(file.id);
    if (!pending) {
      pending = this.probeOnce(file, input, opts.allowRetry ?? true).finally(() => this.probing.delete(file.id));
      this.probing.set(file.id, pending);
    }
    return pending;
  }

  private async probeOnce(file: FileRow, input: string, allowRetry: boolean): Promise<MediaInfo> {
    const ff = this.ffmpeg();
    if (!ff) {
      // No ffprobe here (the cloud server never has one): the app reads the file's
      // details itself from the same link and sends them (POST /files/:id/probe).
      if (file.provider === "torbox") throw new NeedsProbeError(file.id, input);
      throw new PlaybackError("ffmpeg/ffprobe is not installed on the server", 503);
    }
    try {
      return await this.saveProbe(file, await probe(ff.ffprobe, input));
    } catch (err) {
      // Details (already redacted) go to the log; clients get a plain message.
      log.warn(`Probe failed for file ${file.id}`, err);
      // Only a stalled TorBox link is worth one more try; an unreadable file isn't.
      if (file.provider === "local" || !allowRetry || !isNetworkStall(err)) return this.probeFailed(file);
    }
    // TorBox's CDN sometimes stalls on a link (seen right after a release is added):
    // one retry with a fresh link, within a tighter budget than the first attempt.
    if (this.links.get(file.id)?.url === input) this.links.delete(file.id);
    try {
      const fresh = await this.resolveInput(file);
      const info = await this.saveProbe(file, await probe(ff.ffprobe, fresh.input, 30_000, 20_000));
      log.info(`Probe for file ${file.id} succeeded on retry`);
      return info;
    } catch (err) {
      log.warn(`Probe retry failed for file ${file.id}`, err);
      this.links.delete(file.id);
      return this.probeFailed(file);
    }
  }

  /**
   * Media info the app read itself (from the link this server gave it). Stored like a
   * probe; a file already probed keeps what it has.
   */
  async acceptProbe(fileId: number, info: MediaInfo): Promise<boolean> {
    const file = await this.library.get(fileId);
    if (!file) return false;
    if (!file.probeJson) await this.saveProbe(file, info);
    return true;
  }

  private async saveProbe(file: FileRow, info: MediaInfo): Promise<MediaInfo> {
    await this.library.saveProbe(file.id, info);
    this.probeFailures.delete(file.id);
    return info;
  }

  /** Remembers the failure briefly so repeated plays fail fast instead of re-probing. */
  private probeFailed(file: FileRow): never {
    this.probeFailures.set(file.id, Date.now());
    throw this.probeError(file);
  }

  private probeError(file: FileRow): PlaybackError {
    return file.provider === "local"
      ? new PlaybackError("Could not read this file", 502)
      : new PlaybackError("TorBox didn't respond in time. Try again in a moment.", 502);
  }
}
