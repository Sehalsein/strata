import { realpathSync } from "node:fs";

/** Exit code that tells the service manager (or the foreground supervisor) to start us again. */
export const RESTART_EXIT_CODE = 75;

/**
 * Path of the running `bun build --compile` binary, or null when running from source
 * (`bun src/main.ts`), where self-update and `service install` make no sense.
 */
export function compiledBinaryPath(): string | null {
  // A compiled binary's entry module lives in Bun's embedded virtual filesystem.
  const main = Bun.main;
  if (!main.startsWith("/$bunfs/") && !/^[A-Za-z]:[\\/]~BUN[\\/]/.test(main)) return null;
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

/** True when launchd/systemd (via our unit files) will restart the process when it exits. */
export function underServiceManager(): boolean {
  return process.env.STRATA_SERVICE === "1" || !!process.env.INVOCATION_ID;
}

export function inDocker(): boolean {
  return process.env.STRATA_DOCKER === "1";
}
