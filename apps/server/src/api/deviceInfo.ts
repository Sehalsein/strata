import type { Context } from "hono";
import type { Env } from "./context";
import type { DeploymentProfile } from "../profile";
import { clientAddress, isLocalAddress } from "./localNetwork";

/** What a request says about the device making it, for the Devices page. */
export interface DeviceInfo {
  ipAddress: string | null;
  /** "Home network", "City, Region, Country" from Cloudflare, or null when unknown. */
  location: string | null;
  /** The Strata apps' own name and model for the device (X-Strata-Device-Name/-Model). */
  deviceName: string | null;
  deviceModel: string | null;
  userAgent: string | null;
}

/** Cloudflare's visitor location: Workers' `request.cf`, or a Cloudflare proxy's headers. */
interface CfLocation {
  city?: string;
  region?: string;
  country?: string;
}

/** A header value safe to store and show: printable, at most 80 characters. */
function clean(value: string | undefined | null): string | null {
  const text = (value ?? "").replace(/[^\P{C}]/gu, "").trim().slice(0, 80);
  return text || null;
}

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

function countryName(code: string | undefined): string | undefined {
  if (!code || !/^[A-Z]{2}$/i.test(code) || code.toUpperCase() === "XX" || code.toUpperCase() === "T1") return undefined;
  try {
    return countryNames?.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function locationOf(c: Context<Env>, ip: string | null): string | null {
  if (ip && isLocalAddress(ip)) return "Home network";
  let cf: CfLocation | undefined = (c.req.raw as Request & { cf?: CfLocation }).cf;
  // Headers only count behind a proxy this server trusts (as for the client's address).
  if (!cf && (c.var.services.profile.behindProxy || process.env.STRATA_TRUST_PROXY === "1")) {
    cf = { city: c.req.header("cf-ipcity"), region: c.req.header("cf-region"), country: c.req.header("cf-ipcountry") };
  }
  if (!cf) return null;
  const city = clean(cf.city);
  const region = clean(cf.region);
  const parts = [city, region !== city ? region : null, countryName(cf.country)].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function describeDevice(c: Context<Env>): DeviceInfo {
  const address = clientAddress(c);
  const ipAddress = address && address !== "unknown" ? address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "") : null;
  const userAgent = c.req.header("user-agent")?.trim();
  return {
    ipAddress,
    location: locationOf(c, ipAddress),
    deviceName: clean(c.req.header("x-strata-device-name")),
    deviceModel: clean(c.req.header("x-strata-device-model")),
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}

/**
 * MAC addresses of devices on this server's home network, by IPv4 address, from the
 * machine's ARP table. MACs never travel over HTTP, so this is all there is, and only on a
 * home server: a cloud server (or a container on its own network) sees none.
 */
export async function homeNetworkMacs(profile: DeploymentProfile): Promise<Map<string, string>> {
  const macs = new Map<string, string>();
  if (profile.behindProxy) return macs;
  try {
    const { platform } = await import("node:os");
    if (platform() === "linux") {
      const { readFile } = await import("node:fs/promises");
      // IP address  HW type  Flags  HW address  Mask  Device
      for (const line of (await readFile("/proc/net/arp", "utf8")).split("\n").slice(1)) {
        const [ip, , flags, mac] = line.trim().split(/\s+/);
        if (ip && mac && flags !== "0x0") add(macs, ip, mac);
      }
    } else if (platform() === "darwin") {
      const { execFile } = await import("node:child_process");
      const out = await new Promise<string>((resolve) => execFile("arp", ["-an"], { timeout: 2000 }, (_err, stdout) => resolve(stdout ?? "")));
      // ? (192.168.2.10) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
      for (const m of out.matchAll(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]+) /gi)) add(macs, m[1]!, m[2]!);
    }
  } catch {
    // No ARP table to read: no MACs.
  }
  return macs;
}

function add(macs: Map<string, string>, ip: string, raw: string) {
  const parts = raw.toLowerCase().split(":");
  if (parts.length !== 6) return;
  const mac = parts.map((p) => p.padStart(2, "0")).join(":");
  if (mac === "00:00:00:00:00:00" || mac === "ff:ff:ff:ff:ff:ff") return;
  macs.set(ip, mac);
}

/**
 * A "locally administered" MAC (the second hex digit 2, 6, A or E): one the device made
 * up, like the private Wi-Fi address iPhones and iPads use, a different one per network.
 */
export function isPrivateMac(mac: string): boolean {
  return /^[0-9a-f][26ae]:/i.test(mac);
}

/**
 * What to change on a stored session for this request, or null when nothing has. The
 * address and location move together; the name, model and user agent change only when the
 * request sends them (a browser sends no name).
 */
export function deviceChanges(stored: Partial<DeviceInfo>, now: DeviceInfo): Partial<DeviceInfo> | null {
  const changes: Partial<DeviceInfo> = {};
  if (now.ipAddress && (now.ipAddress !== stored.ipAddress || now.location !== (stored.location ?? null))) {
    changes.ipAddress = now.ipAddress;
    changes.location = now.location;
  }
  for (const key of ["deviceName", "deviceModel", "userAgent"] as const) {
    if (now[key] && now[key] !== stored[key]) changes[key] = now[key];
  }
  return Object.keys(changes).length ? changes : null;
}
