import type { Context } from "hono";
import type { Env } from "./context";

/** Headers a reverse proxy or tunnel adds: behind one, every client looks local, so we don't trust it. */
const PROXY_HEADERS = ["forwarded", "x-forwarded-for", "x-real-ip", "cf-connecting-ip", "true-client-ip"];

/**
 * Whether the request comes straight from this machine or the home network
 * (loopback, private IPv4 ranges, link-local, IPv6 unique-local). Proxied
 * requests never count, whatever address the proxy connects from.
 */
export function isLocalRequest(c: Context<Env>): boolean {
  if (PROXY_HEADERS.some((h) => c.req.header(h) !== undefined)) return false;
  // Browsers send Origin on cross-site and POST requests; the apps never do. Refusing it
  // stops a web page on the LAN (or a DNS-rebound one) from joining on someone's behalf.
  if (c.req.header("origin") !== undefined) return false;
  if (!isLocalHost(c.req.header("host") ?? new URL(c.req.url).host)) return false;
  const address = c.env?.requestIP?.(c.req.raw)?.address;
  return address ? isLocalAddress(address) : false;
}

/**
 * The Host the client used must be an IP, localhost, or a home-network name. DNS
 * rebinding needs the attacker's own domain in Host, which never matches these.
 */
export function isLocalHost(raw: string | undefined): boolean {
  if (!raw) return false;
  const host = raw.toLowerCase().replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return true;
  if (host === "localhost" || !host.includes(".")) return true;
  return /\.(local|lan|home|internal|home\.arpa)$/.test(host);
}

export function isLocalAddress(raw: string): boolean {
  const address = raw.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  const v4 = address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (address === "::1") return true;
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  return /^f[cd][0-9a-f]{0,2}:/.test(address) || /^fe[89ab][0-9a-f]?:/.test(address);
}

const JOIN_LIMIT = 10;
const JOIN_WINDOW_MS = 10 * 60_000;
const joins = new Map<string, number[]>();

/** At most 10 password-less joins per client address per 10 minutes. */
export function allowJoin(c: Context<Env>, now = Date.now()): boolean {
  const address = c.env?.requestIP?.(c.req.raw)?.address ?? "unknown";
  const recent = (joins.get(address) ?? []).filter((t) => now - t < JOIN_WINDOW_MS);
  if (recent.length >= JOIN_LIMIT) {
    joins.set(address, recent);
    return false;
  }
  recent.push(now);
  joins.set(address, recent);
  return true;
}
