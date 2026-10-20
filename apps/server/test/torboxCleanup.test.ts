import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TorboxHousekeeping } from "../src/sources/torbox/cleanup";
import type { TorboxClient } from "../src/sources/torbox/client";
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

    const deleted: number[] = [];
    const client = { deleteTorrent: async (id: number) => void deleted.push(id) } as unknown as TorboxClient;
    const result = await hk.clean(client, 14, (id) => id === 4);

    expect(result.removed).toBe(1);
    // Torrent 99 was added in TorBox by hand: it isn't recorded, so it can't be removed.
    expect(deleted).toEqual([1]);
    expect(hk.count()).toBe(3);
  });

  test("0 days keeps everything", async () => {
    const hk = new TorboxHousekeeping(server.services.db, server.services.library, () => 1_000 * DAY);
    const client = { deleteTorrent: async () => { throw new Error("should not be called"); } } as unknown as TorboxClient;
    expect(await hk.clean(client, 0, () => false)).toEqual({ removed: 0, skipped: "cleanup is off" });
  });
});
