import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type { MediaInfo } from "../media/probe";
import type { FfmpegInfo } from "../platform/ffmpeg";
import type { KeepAwake } from "../platform/keepAwake";
import { logger } from "../log";
import type { PlaybackPlan } from "./decide";
import { buildHlsArgs } from "./ffmpegArgs";

const log = logger("playback");

/** Pause ffmpeg once it is this many segments ahead of the player; resume below half. */
const AHEAD_PAUSE = 40;
const IDLE_TIMEOUT_MS = 90_000;
const WAIT_TIMEOUT_MS = 45_000;

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

export class SessionManager {
  private sessions = new Map<string, PlaybackSession>();
  private sweeper: ReturnType<typeof setInterval>;

  constructor(
    private readonly transcodeDir: string,
    private readonly getFfmpeg: () => FfmpegInfo | null,
    private readonly keepAwake: KeepAwake,
    private readonly maxTranscodes: () => number,
    private readonly hwAllowed: () => boolean,
  ) {
    // Leftovers from a crash or restart are never resumable.
    for (const name of existsSync(transcodeDir) ? readdirSync(transcodeDir) : []) rmSync(join(transcodeDir, name), { recursive: true, force: true });
    this.sweeper = setInterval(() => this.sweep(), 2_000);
  }

  create(init: Omit<PlaybackSession, "id" | "createdAt" | "lastAccessAt" | "lastSegmentRequested">): PlaybackSession {
    const session: PlaybackSession = { ...init, id: randomBytes(16).toString("hex"), createdAt: Date.now(), lastAccessAt: Date.now(), lastSegmentRequested: 0 };
    if (session.plan.mode !== "direct") this.startHls(session);
    this.sessions.set(session.id, session);
    this.keepAwake.acquire();
    log.info(`Session ${session.id.slice(0, 8)} ${session.plan.mode} file=${session.fileId}${session.plan.reasons.length ? ` (${session.plan.reasons.join("; ")})` : ""}`);
    return session;
  }

  get(id: string): PlaybackSession | undefined {
    const session = this.sessions.get(id);
    if (session) session.lastAccessAt = Date.now();
    return session;
  }

  list(): PlaybackSession[] {
    return [...this.sessions.values()];
  }

  stop(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
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
    clearInterval(this.sweeper);
    for (const id of [...this.sessions.keys()]) this.stop(id);
  }

  /** Stops the user's other sessions for the same title (e.g. a restart at a new offset). */
  stopForTarget(userId: number, target: SessionTarget) {
    for (const s of this.sessions.values()) {
      if (s.userId === userId && s.target.mediaType === target.mediaType && s.target.tmdbId === target.tmdbId && s.target.season === target.season && s.target.episode === target.episode) {
        this.stop(s.id);
      }
    }
  }

  activeTranscodes(): number {
    return this.list().filter((s) => s.plan.mode !== "direct").length;
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

  private startHls(session: PlaybackSession) {
    const ffmpeg = this.getFfmpeg();
    if (!ffmpeg) throw new Error("ffmpeg is not installed; this file needs remuxing to play");
    if (this.activeTranscodes() >= this.maxTranscodes()) throw new Error("Too many active transcodes; try again shortly");
    session.dir = join(this.transcodeDir, session.id);
    mkdirSync(session.dir, { recursive: true });
    const args = buildHlsArgs({
      ffmpeg: ffmpeg.ffmpeg,
      input: session.input,
      startSeconds: session.startOffsetMs / 1000,
      plan: session.plan,
      info: session.info,
      outDir: session.dir,
      hwEncoder: this.hwAllowed() ? ffmpeg.hwEncoder : undefined,
    });
    log.debug(`ffmpeg ${args.slice(1).join(" ").replace(/token=[^&\s]+/g, "token=***")}`);
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
    session.proc = proc;
    void (async () => {
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      session.exitCode = code;
      if (code !== 0 && this.sessions.has(session.id)) {
        session.error = stderr.trim().split("\n").slice(-3).join(" | ").replace(/token=[^&\s]+/g, "token=***");
        log.warn(`ffmpeg exited ${code} for ${session.id.slice(0, 8)}: ${session.error}`);
      }
    })();
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
      const timeout = session.plan.mode === "direct" ? IDLE_TIMEOUT_MS * 4 : IDLE_TIMEOUT_MS;
      if (now - session.lastAccessAt > timeout) this.stop(session.id);
      else this.throttle(session);
    }
  }
}
