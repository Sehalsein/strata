import { appendFileSync } from "node:fs";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: Level;
  scope: string;
  message: string;
}

const RING_SIZE = 1000;
const ring: LogEntry[] = [];
let logFile: string | undefined;

export function setLogDir(dir: string) {
  logFile = join(dir, "strata.log");
}

export function recentLogs(limit = 200): LogEntry[] {
  return ring.slice(-limit);
}

function write(level: Level, scope: string, message: string, extra?: unknown) {
  const detail = extra instanceof Error ? ` ${extra.message}` : extra !== undefined ? ` ${JSON.stringify(extra)}` : "";
  const entry: LogEntry = { time: new Date().toISOString(), level, scope, message: message + detail };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  if (level === "debug" && !process.env.STRATA_DEBUG) return;
  const line = `${entry.time} ${level.toUpperCase().padEnd(5)} [${scope}] ${entry.message}`;
  (level === "error" || level === "warn" ? console.error : console.log)(line);
  if (logFile) {
    try {
      appendFileSync(logFile, line + "\n");
    } catch {
      // Logging must never take the server down.
    }
  }
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => write("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => write("error", scope, msg, extra),
  };
}
