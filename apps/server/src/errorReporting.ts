import { redactSecrets } from "./log";
import { VERSION } from "./version";

/**
 * Errors to Sentry when SENTRY_DSN is set: one small request per error, sent straight to
 * Sentry's envelope endpoint, so it works the same on Bun and on Workers. Messages pass
 * through redactSecrets; the same message is sent at most once a minute.
 */
const recent = new Map<string, number>();
let pending: Promise<unknown>[] = [];

function dsn(): { url: string; key: string } | null {
  const raw = process.env.SENTRY_DSN;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const project = u.pathname.replace(/^\/+/, "");
    return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

export function reportError(scope: string, message: string, error?: unknown) {
  const target = dsn();
  if (!target) return;
  const text = redactSecrets(error instanceof Error ? `${message}: ${error.message}` : message);
  const now = Date.now();
  if ((recent.get(text) ?? 0) > now - 60_000) return;
  recent.set(text, now);
  if (recent.size > 500) recent.clear();
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: now / 1000,
    platform: "javascript",
    level: "error",
    logger: scope,
    release: `strata-server@${VERSION}`,
    environment: process.env.STRATA_MODE ?? "home",
    message: { formatted: text },
    exception:
      error instanceof Error
        ? { values: [{ type: error.name, value: redactSecrets(error.message), stacktrace: error.stack ? { frames: stackFrames(error.stack) } : undefined }] }
        : undefined,
  };
  const body = [JSON.stringify({ event_id: event.event_id, sent_at: new Date(now).toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
  const sent = fetch(target.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=strata/${VERSION}, sentry_key=${target.key}` },
    body,
  }).catch(() => {});
  pending.push(sent);
  void sent.finally(() => (pending = pending.filter((p) => p !== sent)));
}

/** Sends still in flight (a Worker waits for these before its request ends). */
export function pendingReports(): Promise<unknown> {
  return Promise.all(pending);
}

function stackFrames(stack: string) {
  return stack
    .split("\n")
    .slice(1, 30)
    .map((line) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ function: m[1] ?? "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) }))
    .reverse();
}
