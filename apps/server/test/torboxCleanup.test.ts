import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TorboxHousekeeping } from "../src/sources/torbox/cleanup";
import { TorboxError, type TorboxClient } from "../src/sources/torbox/client";
import { startTestServer, type TestServer } from "./helpers";

const DAY = 24 * 60 * 60_000;
let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(() => server.services.shutdown());

describe("TorBox housekeeping", () => {
  test("removes only releases Strata added that nobody played for the configured days", async () => {
    let now = 100 * DAY;
    const hk = new TorboxHousekeeping(server.services.db, server.services.library, () => now);
    const at = (daysAgo: number) => (now = 100 * DAY - daysAgo * DAY);

    at(20); hk.recordAdded(1, "a".repeat(40), "Stale");
    at(20); hk.recordAdded(2, "b".repeat(40), "Played lately");
    at(2); hk.recordPlayed(2);
    at(2); hk.recordAdded(3, "c".repeat(40), "Added lately");
    at(20); hk.recordAdded(4, "d".repeat(40), "Streaming now");
    at(0);

    at(20); hk.recordAdded(5, "e".repeat(40), "Id reused");
    at(20); hk.recordAdded(6, "f".repeat(40), "Already gone");
    at(0);

    const remote: Record<number, string> = { 1: "a".repeat(40), 4: "d".repeat(40), 5: "9".repeat(40) };
    const deleted: number[] = [];
    const client = {
      torrent: async (id: number) => {
        if (!remote[id]) throw new TorboxError("not found", 404);
        return { id, hash: remote[id] };
      },
      deleteTorrent: async (id: number) => void deleted.push(id),
    } as unknown as TorboxClient;
    const result = await hk.clean(client, 14, (id) => id === 4);

    expect(result.removed).toBe(1);
    // Only the stale release whose hash still matches is deleted. Id 5 now holds a different
    // torrent and id 6 is gone: both are forgotten, never deleted. Hand-added torrents
    // aren't recorded at all, so they can't be removed.
    expect(deleted).toEqual([1]);
    expect(hk.count()).toBe(3); // 2 (played lately), 3 (added lately), 4 (streaming)
  });

  test("0 days keeps everything", async () => {
    const hk = new TorboxHousekeeping(server.services.db, server.services.library, () => 1_000 * DAY);
    const client = { deleteTorrent: async () => { throw new Error("should not be called"); } } as unknown as TorboxClient;
    expect(await hk.clean(client, 0, () => false)).toEqual({ removed: 0, skipped: "cleanup is off" });
  });
});
