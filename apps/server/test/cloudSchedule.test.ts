import { expect, test } from "bun:test";
import { nextCronRun, nextScheduledRun } from "../src/cloudSchedule";

const at = (iso: string) => Date.parse(iso);

test("cron: every N minutes and once a day, in UTC", () => {
  expect(nextCronRun("*/15 * * * *", at("2026-10-31T19:07:00Z"))).toBe(at("2026-10-31T19:15:00Z"));
  expect(nextCronRun("*/15 * * * *", at("2026-10-31T19:15:00Z"))).toBe(at("2026-10-31T19:30:00Z"));
  expect(nextCronRun("17 4 * * *", at("2026-10-31T03:00:00Z"))).toBe(at("2026-10-31T04:17:00Z"));
  expect(nextCronRun("17 4 * * *", at("2026-10-31T19:00:00Z"))).toBe(at("2026-11-01T04:17:00Z"));
  expect(nextScheduledRun("pruneAuth", at("2026-10-31T19:00:00Z"))).toBe(at("2026-11-01T04:17:00Z"));
  expect(nextScheduledRun("scanLocal")).toBeUndefined();
});

test("the Worker's Cron Triggers are exactly the crons the job table uses", async () => {
  const { CRON_JOBS } = await import("../src/cloudSchedule");
  const raw = await Bun.file(new URL("../../../deploy/cloudflare/wrangler.jsonc", import.meta.url)).text();
  // JSONC: drop comments (none of its strings hold "//").
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  expect([...config.triggers.crons].sort()).toEqual(Object.keys(CRON_JOBS).sort());
});
