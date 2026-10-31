import type { DeploymentProfile } from "./profile";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Capability = { [K in keyof DeploymentProfile]: DeploymentProfile[K] extends boolean ? K : never }[keyof DeploymentProfile];

export interface JobSchedule {
  /** Only on a server that has this (local folders, its own state, self-update). */
  needs?: Capability;
  /** In-process timers (Bun): how often, and the first run after starting. */
  everyMs: number | ((settings: { scanIntervalMinutes: number }) => number);
  firstAfterMs: number;
  /** Cloudflare Cron Triggers (Workers), in UTC. Every expression must be in deploy/cloudflare/wrangler.jsonc. */
  cron?: string;
}

/**
 * Every scheduled job, once: what it needs, how often it runs on timers, and which Cron
 * Trigger runs it on Workers. (The jobs' bodies are in services.ts; a job missing here
 * only runs when asked.) test/cloudSchedule.test.ts checks the crons against wrangler.jsonc.
 */
export const JOB_SCHEDULE: Record<string, JobSchedule> = {
  scanLocal: { needs: "localMedia", everyMs: (s) => Math.max(1, s.scanIntervalMinutes) * MINUTE, firstAfterMs: 5_000 },
  // Every 15 minutes; each household at most every `torboxSyncMinutes`.
  syncTorbox: { everyMs: 15 * MINUTE, firstAfterMs: 8_000, cron: "*/15 * * * *" },
  checkUpdates: { needs: "selfUpdate", everyMs: 6 * 60 * MINUTE, firstAfterMs: 60_000 },
  pruneAuth: { everyMs: DAY, firstAfterMs: 5 * MINUTE, cron: "17 4 * * *" },
  backupDatabase: { needs: "localState", everyMs: DAY, firstAfterMs: 20 * MINUTE },
  cleanTorbox: { everyMs: DAY, firstAfterMs: 10 * MINUTE, cron: "17 4 * * *" },
  pruneCatalogCache: { everyMs: DAY, firstAfterMs: 15 * MINUTE, cron: "17 4 * * *" },
  refreshAnimeIds: { everyMs: DAY, firstAfterMs: 30_000, cron: "17 4 * * *" },
};

/** Which jobs each Cron Trigger runs (src/worker.ts). */
export const CRON_JOBS: Record<string, string[]> = {};
for (const [name, { cron }] of Object.entries(JOB_SCHEDULE)) if (cron) (CRON_JOBS[cron] ??= []).push(name);

/** The next time `cron` fires after `now`: the two forms above, "*\/N * * * *" and "M H * * *". */
export function nextCronRun(cron: string, now = Date.now()): number | undefined {
  const [min, hour] = cron.split(" ");
  const every = /^\*\/(\d+)$/.exec(min ?? "");
  if (every && hour === "*") {
    const step = Number(every[1]) * 60_000;
    return Math.floor(now / step) * step + step;
  }
  if (/^\d+$/.test(min ?? "") && /^\d+$/.test(hour ?? "")) {
    const d = new Date(now);
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(hour), Number(min));
    return at > now ? at : at + 24 * 60 * 60_000;
  }
  return undefined;
}

/** A cloud job's next scheduled run, if a cron runs it. */
export function nextScheduledRun(job: string, now = Date.now()): number | undefined {
  const runs = Object.entries(CRON_JOBS)
    .filter(([, jobs]) => jobs.includes(job))
    .map(([cron]) => nextCronRun(cron, now))
    .filter((t): t is number => t !== undefined);
  return runs.length ? Math.min(...runs) : undefined;
}
