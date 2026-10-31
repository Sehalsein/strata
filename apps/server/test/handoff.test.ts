import { describe, expect, test } from "bun:test";
import { PlaybackService } from "../src/playback/service";
import type { PlaybackSession } from "../src/playback/sessions";

describe("handing a file to the app", () => {
  const service = () =>
    new PlaybackService({} as never, {} as never, {} as never, () => ({}) as never, () => null, () => null, {} as never, async () => null, () => {});
  const session = (input: string, inputKind: "url" | "path") => ({ id: "abc", input, inputKind }) as PlaybackSession;

  test("a TorBox link goes to the app as it is, so nothing streams through the server", () => {
    const link = "https://nexus-1.enam.tb-cdn.io/dld/xyz?token=key";
    expect(service().handOff(session(link, "url"))).toBe(link);
  });

  test("files on the server's disk are served by the server", () => {
    expect(service().handOff(session("/media/film.mkv", "path"))).toBe("/api/stream/abc/file");
  });
});
