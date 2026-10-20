import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

/** Non-internal IPv4 addresses of this machine. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

/** URLs the dashboard is reachable at, LAN addresses first. */
export function dashboardUrls(host: string, port: number): string[] {
  const wildcard = host === "0.0.0.0" || host === "::";
  const hosts = wildcard ? [...lanAddresses(), "localhost"] : [host];
  return hosts.map((h) => `http://${h.includes(":") ? `[${h}]` : h}:${port}`);
}

/**
 * A stable id for this install (advertised over Bonjour and returned by /api/info) so clients
 * recognise the server across IP and name changes. Lives in the data dir, so it moves with it.
 */
export function loadServerId(dataDir: string): string {
  const file = join(dataDir, "server-id");
  if (existsSync(file)) {
    const id = readFileSync(file, "utf8").trim();
    if (id) return id;
  }
  const id = randomUUID();
  writeFileSync(file, id + "\n");
  return id;
}
