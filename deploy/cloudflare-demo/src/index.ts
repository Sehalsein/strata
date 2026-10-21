// The public Strata demo on Cloudflare: this Worker is the only way in. It answers only
// the requests a viewer needs (sign in, browse, play, save progress), applies strict
// global limits in one Durable Object (the Gate), and only then wakes the container
// that runs the demo server (Dockerfile; scripts/demo/serve.ts --public).
import { Container } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";
import { LIMITS } from "./limits";

export interface Env {
  STRATA: DurableObjectNamespace<StrataDemo>;
  GATE: DurableObjectNamespace<Gate>;
  EDGE_LIMIT: RateLimit;
  /** Secret: `wrangler secret put TMDB_API_KEY`. */
  TMDB_API_KEY: string;
}

/** The demo server. One instance at most (wrangler.jsonc), asleep when idle. */
export class StrataDemo extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = LIMITS.sleepAfter;

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = { TMDB_API_KEY: env.TMDB_API_KEY };
  }
}

type Kind = "api" | "signin" | "play" | "stream";

/** What the demo answers, and how each request counts. Everything else is refused. */
function classify(method: string, url: URL): Kind | null {
  const p = url.pathname;
  if (method === "GET") {
    if (p.startsWith("/api/stream/")) return "stream";
    if (p === "/api/sources" && url.searchParams.has("discover")) return null; // release search
    if (/^\/api\/(info|me|profiles|home|search|sources|anime|anime\/categories)$/.test(p)) return "api";
    if (/^\/api\/(genres|browse|titles|person)\//.test(p)) return "api";
    return null;
  }
  if (method === "POST") {
    if (p === "/api/auth/login") return "signin";
    if (p === "/api/play") return "play";
    if (/^\/api\/(auth\/logout|progress|watched|profiles\/\d+\/select)$/.test(p)) return "api";
    return null;
  }
  if (method === "PUT" && p === "/api/watchlist") return "api";
  if (method === "DELETE" && /^\/api\/(play\/[a-f0-9]{16,64}|continue\/(movie|show)\/\d+)$/.test(p)) return "api";
  return null;
}

const json = (status: number, error: string, retryAfter?: number) =>
  Response.json({ error }, { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Strata demo server. Open the Strata app and connect to this address.\nSign in: demo / strata-demo\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const kind = classify(request.method, url);
    if (!kind) return json(403, "That isn't available in the demo.");
    // Bodies are read here, not trusted from Content-Length: anything past the cap is refused.
    let body: ArrayBuffer | undefined;
    if (request.method !== "GET" && request.body) {
      const read = await readCapped(request.body, LIMITS.maxBodyBytes);
      if (!read) return json(413, "Request too large.");
      body = read;
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    // A cheap first filter at the edge (approximate, per location), then the strict one.
    const edge = await env.EDGE_LIMIT.limit({ key: ip });
    if (!edge.success) return json(429, "Slow down a little.", 60);
    const gate = env.GATE.get(env.GATE.idFromName("global"));
    // Streams reserve their bytes before anything is sent (the requested range, or a whole
    // clip), so parallel requests can't overrun the budget; the real count settles it.
    const reserve = kind === "stream" ? rangeLength(request.headers.get("Range")) ?? LIMITS.maxClipBytes : 0;
    const verdict = await gate.admit(kind, ip, Date.now(), reserve);
    if (!verdict.ok) return json(verdict.status, verdict.reason, verdict.retryAfter);

    const forwarded = new Request(request, body !== undefined ? { body } : {});
    let res: Response;
    try {
      res = await env.STRATA.get(env.STRATA.idFromName("demo")).fetch(forwarded);
    } catch (err) {
      if (kind === "stream") ctx.waitUntil(gate.settle(ip, reserve, 0, Date.now()));
      throw err;
    }
    if (kind !== "stream") return res;
    if (!res.ok || !res.body) {
      ctx.waitUntil(gate.settle(ip, reserve, 0, Date.now()));
      return res;
    }
    // Count what actually goes out, and settle when the response ends (or is cut off).
    let sent = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    ctx.waitUntil(res.body.pipeTo(counter.writable).catch(() => {}).finally(() => gate.settle(ip, reserve, sent, Date.now())));
    return new Response(counter.readable, res);
  },
} satisfies ExportedHandler<Env>;

type Verdict = { ok: true } | { ok: false; status: number; reason: string; retryAfter?: number };

/**
 * One instance ("global") counts every request, so the limits hold across all of
 * Cloudflare's locations. Short windows live in memory; daily and monthly totals are
 * stored, so a restart doesn't reset the budget.
 */
export class Gate extends DurableObject<Env> {
  private windows = new Map<string, number[]>();
  private viewers = new Map<string, number>();
  private inFlight = new Map<string, number>();

  async admit(kind: Kind, ip: string, now: number, reserve = 0): Promise<Verdict> {
    const { perVisitor: v, global: g } = LIMITS;
    const minute = 60_000;
    const hour = 60 * minute;
    if (!this.hit("g:req", g.requestsPerMinute, minute, now)) return busy("The demo is busy right now. Try again in a minute.", 60);
    if (!this.hit(`ip:${ip}:req`, v.requestsPerMinute, minute, now)) return slow(60);

    if (kind === "signin") {
      if (!(await this.hitStored(`ip:${ip}:signin`, v.signInsPerHour, hour, now))) return slow(3600);
      if (!(await this.hitStored("g:signin", g.signInsPerHour, hour, now))) return busy("Too many sign-ins on the demo right now. Try again later.", 3600);
    }

    if (kind === "play") {
      this.forgetIdleViewers(now);
      if (!this.viewers.has(ip) && this.viewers.size >= g.concurrentViewers) return busy("The demo is at capacity. Try again in a few minutes.", 180);
      if (!(await this.hitStored(`ip:${ip}:play`, v.playsPerHour, hour, now))) return slow(3600);
      const playsKey = `day:${day(now)}:plays`;
      const plays = (await this.ctx.storage.get<number>(playsKey)) ?? 0;
      if (plays >= g.playsPerDay) return busy("The demo has reached today's playback limit. Try again tomorrow.", untilTomorrow(now));
      await this.ctx.storage.put(playsKey, plays + 1);
      this.viewers.set(ip, now);
    }

    if (kind === "stream" || kind === "play") {
      const [mine, today, thisMonth] = await Promise.all([
        this.ctx.storage.get<number>(`day:${day(now)}:bytes:${ip}`),
        this.ctx.storage.get<number>(`day:${day(now)}:bytes`),
        this.ctx.storage.get<number>(`month:${month(now)}:bytes`),
      ]);
      if ((mine ?? 0) + reserve > v.bytesPerDay) return busy("You've reached today's demo viewing limit. Try again tomorrow.", untilTomorrow(now));
      if ((today ?? 0) + reserve > g.bytesPerDay || (thisMonth ?? 0) + reserve > g.bytesPerMonth) return busy("The demo has reached its viewing limit for now. Try again tomorrow.", untilTomorrow(now));
    }

    if (kind === "stream") {
      const open = this.inFlight.get(ip) ?? 0;
      if (open >= v.streamsInFlight) return slow(10);
      this.inFlight.set(ip, open + 1);
      await this.spend(ip, reserve, now);
      this.viewers.set(ip, now);
    }
    return { ok: true };
  }

  /** A stream ended: swap its reservation for the bytes actually sent. */
  async settle(ip: string, reserved: number, sent: number, now: number): Promise<void> {
    const open = (this.inFlight.get(ip) ?? 1) - 1;
    if (open > 0) this.inFlight.set(ip, open);
    else this.inFlight.delete(ip);
    await this.spend(ip, sent - reserved, now);
  }

  /** Adds (or, settling a reservation, takes back) bytes on the visitor's and the demo's budgets. */
  private async spend(ip: string, bytes: number, now: number): Promise<void> {
    if (!Number.isFinite(bytes) || bytes === 0) return;
    const keys = [`day:${day(now)}:bytes:${ip}`, `day:${day(now)}:bytes`, `month:${month(now)}:bytes`];
    const values = await this.ctx.storage.get<number>(keys);
    const next: Record<string, number> = {};
    for (const key of keys) next[key] = Math.max(0, (values.get(key) ?? 0) + bytes);
    await this.ctx.storage.put(next);
    // Old daily and monthly counters aren't needed once their period is over: sweep daily.
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + 24 * 60 * 60_000);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const keep = [`day:${day(now)}`, `month:${month(now)}`];
    const all = await this.ctx.storage.list<number | number[]>();
    const stale = [...all.entries()]
      .filter(([k, v]) => (k.startsWith("win:") ? !(v as unknown as number[]).some((t) => now - t < 60 * 60_000) : !keep.some((prefix) => k.startsWith(prefix))))
      .map(([k]) => k);
    for (let i = 0; i < stale.length; i += 128) await this.ctx.storage.delete(stale.slice(i, i + 128));
  }

  /**
   * The same, kept in storage: for hour-long windows, which must survive the object
   * being evicted from memory between requests.
   */
  private async hitStored(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    const storageKey = `win:${key}`;
    const recent = ((await this.ctx.storage.get<number[]>(storageKey)) ?? []).filter((t) => now - t < windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(now);
    if (recent.length) await this.ctx.storage.put(storageKey, recent);
    else await this.ctx.storage.delete(storageKey);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + 24 * 60 * 60_000);
    return allowed;
  }

  /** Sliding window in memory (minute-long windows): false once `limit` hits fall within `windowMs`. */
  private hit(key: string, limit: number, windowMs: number, now: number): boolean {
    const recent = (this.windows.get(key) ?? []).filter((t) => now - t < windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(now);
    this.windows.set(key, recent);
    if (this.windows.size > 10_000) {
      for (const [k, list] of this.windows) if (!list.some((t) => now - t < 60 * 60_000)) this.windows.delete(k);
    }
    return allowed;
  }

  private forgetIdleViewers(now: number) {
    for (const [ip, at] of this.viewers) if (now - at > 3 * 60_000) this.viewers.delete(ip);
  }
}

const slow = (retryAfter: number): Verdict => ({ ok: false, status: 429, reason: "Slow down a little.", retryAfter });
const busy = (reason: string, retryAfter: number): Verdict => ({ ok: false, status: 503, reason, retryAfter });
const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const month = (now: number) => new Date(now).toISOString().slice(0, 7);
const untilTomorrow = (now: number) => Math.ceil((Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1) - now) / 1000);

/** Reads a body, giving up (null) once it passes `max` bytes. */
async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<ArrayBuffer | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}

/** Bytes a "bytes=a-b" Range asks for; null when open-ended or absent. */
function rangeLength(range: string | null): number | null {
  const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range.trim()) : null;
  if (!m) return null;
  const length = Number(m[2]) - Number(m[1]) + 1;
  return length > 0 ? Math.min(length, LIMITS.maxClipBytes) : null;
}
