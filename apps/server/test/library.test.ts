import { expect, test } from "bun:test";
import { startTestServer } from "./helpers";
import { ingestItem } from "../src/sources/torbox/sync";

test("Recently Added follows when files were added to TorBox, not when Strata matched them", async () => {
  const server = await startTestServer();
  const { library } = server.services;
  const item = (id: number, name: string, created_at?: string) => ({ id, hash: String(id).padStart(40, "0"), name, size: 1, files: [{ id: 0, name: `${name}.mkv`, size: 1 }], created_at });

  // Synced before TorBox dates were kept: no time yet.
  const [older] = ingestItem(library, "torrents", item(1, "Big.Buck.Bunny.2008.1080p"));
  const [newer] = ingestItem(library, "torrents", item(2, "Evil.Movie.2020.1080p", "2026-10-20T10:00:00Z"));
  await library.setManualMatch(older!.id, "movie", 10378, undefined, undefined, "matched");
  await library.setManualMatch(newer!.id, "movie", 666, undefined, undefined, "matched");

  // The next sync brings the add date: recorded without unmatching or dropping the probe.
  library.saveProbe(older!.id, { container: "mkv" } as never);
  const [again] = ingestItem(library, "torrents", item(1, "Big.Buck.Bunny.2008.1080p", "2026-10-21T09:00:00Z"));
  expect(again).toMatchObject({ matchStatus: "matched", mtime: Date.parse("2026-10-21T09:00:00Z") });
  expect(again!.probeJson).not.toBeNull();

  // Matched first but added to TorBox last: it leads.
  expect(library.recentlyAdded("movie").map((m) => m.tmdbId)).toEqual([10378, 666]);
  server.services.shutdown();
});
