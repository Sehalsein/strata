/**
 * When the cloud server's jobs run: Cloudflare Cron Triggers (the `triggers.crons` in
 * deploy/cloudflare/wrangler.jsonc, which must list the same expressions), in UTC.
 */
export const CRON_JOBS: Record<string, string[]> = {
  "*/15 * * * *": ["syncTorbox"],
  "17 4 * * *": ["cleanTorbox", "pruneAuth", "pruneCatalogCache", "refreshAnimeIds"],
};

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
