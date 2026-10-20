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
  const address = c.env?.requestIP?.(c.req.raw)?.address;
  return address ? isLocalAddress(address) : false;
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
