import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db";
import { playSessions } from "../db/schema";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type { MediaInfo } from "../media/probe";
import type { FfmpegInfo } from "../platform/ffmpeg";
import type { KeepAwake } from "../platform/keepAwake";
import { logger, redactSecrets } from "../log";
import type { PlaybackPlan } from "./decide";
import { buildHlsArgs } from "./ffmpegArgs";
import type { SubtitleTrack } from "./subtitles";

const log = logger("playback");

/** Pause ffmpeg once it is this many segments ahead of the player; resume below half. */
const AHEAD_PAUSE = 40;
const IDLE_TIMEOUT_MS = 90_000;
const WAIT_TIMEOUT_MS = 45_000;
/**
 * VideoToolbox can wedge (every encode call blocks, nothing is written). A hardware
 * transcode with no first segment by then is restarted on the software encoder, and
 * the hardware encoder is left alone for a while.
 */
const HW_STALL_MS = 12_000;
const HW_COOLDOWN_MS = 10 * 60_000;

export interface SessionTarget {
  mediaType: "movie" | "episode";
  tmdbId: number;
  season?: number;
  episode?: number;
}

export interface PlaybackSession {
  id: string;
  profileId: number;
  userId: number;
  fileId: number;
  target: SessionTarget;
  plan: PlaybackPlan;
  info: MediaInfo;
  /** Local path or TorBox URL. */
  input: string;
  inputKind: "path" | "url";
  startOffsetMs: number;
  subtitles: SubtitleTrack[];
  createdAt: number;
  lastAccessAt: number;
  // HLS only
  dir?: string;
  proc?: Subprocess;
  paused?: boolean;
  lastSegmentRequested: number;
  exitCode?: number | null;
  error?: string;
}

/** Remux and transcode run ffmpeg here; direct and device play only hand out a link. */
export const isHls = (mode: PlaybackPlan["mode"]) => mode === "remux" || mode === "transcode";

/** A TorBox play nobody has touched for this long (no progress, no link refresh) is over. */
const LINK_SESSION_IDLE_MS = 4 * IDLE_TIMEOUT_MS * 10;

/**
 * Playback sessions. A TorBox play only hands the app a link, so its session lives in
 * the database (`play_sessions`) where every server sharing it can find it — the cloud
 * server keeps nothing in memory between requests. A local file streamed by this
 * server's ffmpeg keeps its session here in memory, with the process.
 */
export class SessionManager {
  private sessions = new Map<string, PlaybackSession>();
  private hwStalledAt = 0;
  private sweeper?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: Db,
    /** Null on the cloud server: no local files, no ffmpeg, no timers. */
    private readonly local: {
      transcodeDir: string;
      getFfmpeg: () => FfmpegInfo | null;
      keepAwake: KeepAwake;
      maxTranscodes: () => number;
      hwAllowed: () => boolean;
    } | null,
  ) {
    if (!local) return;
    // Leftovers from a crash or restart are never resumable.
    for (const name of existsSync(local.transcodeDir) ? readdirSync(local.transcodeDir) : []) rmSync(join(local.transcodeDir, name), { recursive: true, force: true });
    this.sweeper = setInterval(() => this.sweep(), 2_000);
  }

  private get transcodeDir() {
    return this.local!.transcodeDir;
  }
  private get getFfmpeg() {
    return this.local!.getFfmpeg;
  }
  private get keepAwake() {
    return this.local!.keepAwake;
  }
  private get maxTranscodes() {
    return this.local!.maxTranscodes;
  }
  private get hwAllowed() {
    return this.local!.hwAllowed;
  }

  async create(init: Omit<PlaybackSession, "id" | "createdAt" | "lastAccessAt" | "lastSegmentRequested">): Promise<PlaybackSession> {
    const now = Date.now();
    const session: PlaybackSession = { ...init, id: randomBytes(16).toString("hex"), createdAt: now, lastAccessAt: now, lastSegmentRequested: 0 };
    if (init.inputKind === "url" && !isHls(init.plan.mode)) {
      await this.db.insert(playSessions).values({
        id: session.id,
        userId: init.userId,
        profileId: init.profileId,
        fileId: init.fileId,
        targetJson: JSON.stringify(init.target),
        planJson: JSON.stringify(init.plan),
        input: init.input,
        createdAt: now,
        lastAccessAt: now,
      });
    } else {
      if (!this.local) throw new Error("This server doesn't stream files itself");
      if (isHls(session.plan.mode)) this.startHls(session);
      this.sessions.set(session.id, session);
      this.keepAwake.acquire();
    }
    log.info(`Session ${session.id.slice(0, 8)} ${session.plan.mode} file=${session.fileId}${session.plan.reasons.length ? ` (${session.plan.reasons.join("; ")})` : ""}`);
    return session;
  }

  /** The session, if it's still going; touching it keeps it alive. */
  async get(id: string): Promise<PlaybackSession | undefined> {
    const local = this.sessions.get(id);
    if (local) {
      local.lastAccessAt = Date.now();
      return local;
    }
    if (!/^[0-9a-f]{32}$/.test(id)) return undefined;
    const now = Date.now();
    const [row] = await this.db
      .update(playSessions)
      .set({ lastAccessAt: now })
      .where(and(eq(playSessions.id, id), gt(playSessions.lastAccessAt, now - LINK_SESSION_IDLE_MS)))
      .returning();
    return row ? fromRow(row) : undefined;
  }

  /** Every live session (for the dashboard). */
  async list(): Promise<PlaybackSession[]> {
    const rows = await this.db.select().from(playSessions).where(gt(playSessions.lastAccessAt, Date.now() - LINK_SESSION_IDLE_MS));
    return [...this.sessions.values(), ...rows.map(fromRow)];
  }

  /** Records a fresh link for a TorBox play (the old one expired). */
  async updateLink(session: PlaybackSession, url: string) {
    session.input = url;
    if (!this.sessions.has(session.id)) await this.db.update(playSessions).set({ input: url }).where(eq(playSessions.id, session.id));
  }

  /** Forgets TorBox plays long over. */
  async prune() {
    await this.db.delete(playSessions).where(lt(playSessions.lastAccessAt, Date.now() - LINK_SESSION_IDLE_MS));
  }

  async stop(id: string) {
    if (!this.sessions.has(id)) {
      const gone = await this.db.delete(playSessions).where(eq(playSessions.id, id)).returning({ id: playSessions.id });
      if (gone.length) log.info(`Session ${id.slice(0, 8)} ended`);
      return;
    }
    const session = this.sessions.get(id)!;
    this.sessions.delete(id);
    if (session.proc && session.proc.exitCode === null) {
      if (session.paused) process.kill(session.proc.pid, "SIGCONT");
      session.proc.kill();
    }
    if (session.dir) rmSync(session.dir, { recursive: true, force: true });
    this.keepAwake.release();
    log.info(`Session ${id.slice(0, 8)} ended`);
  }

  stopAll() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const id of [...this.sessions.keys()]) void this.stop(id);
  }

  /** Stops the user's other sessions for the same title (e.g. a restart at a new offset). */
  async stopForTarget(userId: number, target: SessionTarget) {
    const same = (s: PlaybackSession) =>
      s.userId === userId && s.target.mediaType === target.mediaType && s.target.tmdbId === target.tmdbId && s.target.season === target.season && s.target.episode === target.episode;
    for (const s of await this.list()) if (same(s)) await this.stop(s.id);
  }

  activeTranscodes(): number {
    return [...this.sessions.values()].filter((s) => isHls(s.plan.mode)).length;
  }

  /** Waits for an HLS output file to exist (ffmpeg writes .tmp then renames). */
  async waitForFile(session: PlaybackSession, name: string): Promise<string | null> {
    const path = join(session.dir!, name);
    const segment = /^seg(\d+)\.m4s$/.exec(name);
    if (segment) {
      session.lastSegmentRequested = Math.max(session.lastSegmentRequested, Number(segment[1]));
      this.throttle(session);
    }
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (name === "stream.m3u8" ? this.playlistReady(path) : existsSync(path)) return path;
      if (session.proc && session.proc.exitCode !== null && !existsSync(path)) return null;
      await Bun.sleep(150);
    }
    return null;
  }

  private playlistReady(path: string) {
    // Hand out the playlist once the first segment is listed, so the player can start.
    if (!existsSync(path)) return false;
    return existsSync(path.replace("stream.m3u8", "seg00000.m4s"));
  }

  private startHls(session: PlaybackSession, software = false) {
    const ffmpeg = this.getFfmpeg();
    if (!ffmpeg) throw new Error("ffmpeg is not installed; this file needs remuxing to play");
    if (!software && this.activeTranscodes() >= this.maxTranscodes()) throw new Error("Too many active transcodes; try again shortly");
    session.dir = join(this.transcodeDir, session.id);
    mkdirSync(session.dir, { recursive: true });
    const hwEncoder = !software && this.hwAllowed() && Date.now() - this.hwStalledAt > HW_COOLDOWN_MS ? ffmpeg.hwEncoder : undefined;
    const args = buildHlsArgs({
      ffmpeg: ffmpeg.ffmpeg,
      input: session.input,
      startSeconds: session.startOffsetMs / 1000,
      plan: session.plan,
      info: session.info,
      outDir: session.dir,
      hwEncoder,
    });
    log.debug(`ffmpeg ${redactSecrets(args.slice(1).join(" "))}`);
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
    session.proc = proc;
    void (async () => {
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      // A process replaced by the stall restart below isn't the session's any more.
      if (session.proc !== proc) return;
      session.exitCode = code;
      if (code !== 0 && this.sessions.has(session.id)) {
        session.error = redactSecrets(stderr.trim().split("\n").slice(-3).join(" | "));
        log.warn(`ffmpeg exited ${code} for ${session.id.slice(0, 8)}: ${session.error}`);
      }
    })();
    if (hwEncoder && session.plan.mode === "transcode") {
      setTimeout(() => {
        if (session.proc !== proc || proc.exitCode !== null || !this.sessions.has(session.id)) return;
        if (existsSync(join(session.dir!, "seg00000.m4s"))) return;
        log.warn(`Hardware encoder stalled for ${session.id.slice(0, 8)}; restarting on the software encoder`);
        this.hwStalledAt = Date.now();
        session.proc = undefined;
        if (session.paused) process.kill(proc.pid, "SIGCONT");
        session.paused = false;
        proc.kill("SIGKILL");
        rmSync(session.dir!, { recursive: true, force: true });
        this.startHls(session, true);
      }, HW_STALL_MS).unref();
    }
  }

  private produced(session: PlaybackSession): number {
    if (!session.dir) return 0;
    try {
      return readdirSync(session.dir).filter((f) => f.endsWith(".m4s")).length;
    } catch {
      return 0;
    }
  }

  private throttle(session: PlaybackSession) {
    const proc = session.proc;
    if (!proc || proc.exitCode !== null) return;
    const ahead = this.produced(session) - session.lastSegmentRequested;
    if (!session.paused && ahead > AHEAD_PAUSE) {
      process.kill(proc.pid, "SIGSTOP");
      session.paused = true;
    } else if (session.paused && ahead < AHEAD_PAUSE / 2) {
      process.kill(proc.pid, "SIGCONT");
      session.paused = false;
    }
  }

  private sweep() {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      // Direct-play range requests are sparse (AVPlayer buffers minutes at a time), so
      // direct sessions live until progress stops or the client ends them.
      const timeout = isHls(session.plan.mode) ? IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS * 4;
      if (now - session.lastAccessAt > timeout) this.stop(session.id);
      else this.throttle(session);
    }
  }
}

function fromRow(row: typeof playSessions.$inferSelect): PlaybackSession {
  return {
    id: row.id,
    userId: row.userId,
    profileId: row.profileId,
    fileId: row.fileId,
    target: JSON.parse(row.targetJson) as SessionTarget,
    plan: JSON.parse(row.planJson) as PlaybackPlan,
    // Not kept for link sessions: nothing that uses them needs the details again.
    info: { container: "", durationMs: 0, audio: [], subtitles: [], chapters: [] },
    input: row.input,
    inputKind: "url",
    startOffsetMs: 0,
    subtitles: [],
    createdAt: row.createdAt,
    lastAccessAt: row.lastAccessAt,
    lastSegmentRequested: 0,
  };
}
