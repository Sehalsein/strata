import { describe, expect, test } from "bun:test";
import { capsSchema } from "../src/playback/decide";
import { PlaybackService } from "../src/playback/service";
import { settingsSchema } from "../src/settings";
import type { MediaInfo } from "../src/media/probe";
import type { FileRow } from "../src/library";

const mkv = (height: number, width: number): MediaInfo => ({
  container: "matroska,webm",
  durationMs: 7_200_000,
  video: { index: 0, codec: "hevc", width, height, hdr: null },
  audio: [{ index: 1, codec: "dts", channels: 6, language: "eng", isDefault: true }],
  subtitles: [
    { index: 2, codec: "subrip", language: "eng", isDefault: false, isForced: false, isText: true },
    { index: 3, codec: "hdmv_pgs_subtitle", language: "eng", isDefault: false, isForced: false, isText: false },
  ],
  chapters: [{ startMs: 0, title: "Start" }],
});

const file = (id: number, name: string, info: MediaInfo, provider: "torbox" | "local" = "torbox"): FileRow =>
  ({ id, provider, ref: provider === "local" ? `/media/${name}` : `torrents:${id}:1`, name, size: id * 1e9, parsedJson: "{}", probeJson: JSON.stringify(info) }) as unknown as FileRow;

const files = [file(1, "Film.2160p.mkv", mkv(2160, 3840)), file(2, "Film.1080p.mkv", mkv(1080, 1920)), file(3, "Film.local.mkv", mkv(1080, 1920), "local")];

function service() {
  const library = { organizationId: "h1", filesFor: async () => files, get: async (id: number) => files.find((f) => f.id === id) ?? null };
  const torbox = { requestLink: async (_k: string, item: number) => `https://cdn.torbox.test/${item}` };
  const discovery = { available: false };
  return new PlaybackService(library as never, {} as never, {} as never, () => settingsSchema.parse({ sourcePriority: ["torbox", "local"] }), () => null, () => torbox as never, discovery as never, async () => null);
}

const caps = capsSchema.parse({ deviceRemux: true });
const movie = { source: "tmdb" as const, mediaType: "movie" as const, titleId: 42, caps };

describe("downloads", () => {
  test("hand over the TorBox link and the device plan, with the embedded subtitles the app reads", async () => {
    const res = await service().prepareDownload(movie);
    expect(res.fileId).toBe(1);
    expect(res.url).toBe("https://cdn.torbox.test/1");
    expect(res.mode).toBe("device");
    expect(res.remux?.audio).not.toBe("copy");
    expect(res.subtitleTracks).toEqual([
      expect.objectContaining({ id: "s2", embedded: true, streamIndex: 2, url: null }),
      // A picture track: the app draws it.
      expect.objectContaining({ id: "s3", embedded: false, streamIndex: 3, url: null }),
    ]);
    expect(res.chapters).toHaveLength(1);
  });

  test("files on the server's disk download from the server", async () => {
    const res = await service().prepareDownload({ ...movie, candidateId: "file:3" });
    expect(res.url).toBe("/api/files/3/content");
    expect(await service().localPath(3)).toBe("/media/Film.local.mkv");
    expect(await service().localPath(1)).toBeNull();
  });

  test("a fresh link for a TorBox file, none for one on disk", async () => {
    expect(await service().fileLink(2)).toBe("https://cdn.torbox.test/2");
    expect(await service().fileLink(3)).toBeNull();
  });
});

describe("preferMaxHeight (the app on cellular data)", () => {
  test("picks the best source no taller than the limit", async () => {
    expect((await service().prepareDownload({ ...movie, preferMaxHeight: 1080 })).fileId).toBe(2);
  });

  test("falls back to the best source when none fits", async () => {
    expect((await service().prepareDownload({ ...movie, preferMaxHeight: 480 })).fileId).toBe(1);
  });

  test("a source the app chose is kept", async () => {
    expect((await service().prepareDownload({ ...movie, candidateId: "file:1", preferMaxHeight: 720 })).fileId).toBe(1);
  });
});

describe("playing with nothing in the library", () => {
  const release = (hash: string) => ({ hash: hash.repeat(40), title: `Release ${hash}` });
  const withReleases = (acquire: (hash: string) => Promise<unknown>) => {
    const library = { organizationId: "h1", filesFor: async () => [], get: async (id: number) => files.find((f) => f.id === id) ?? null };
    const tried: string[] = [];
    const discovery = {
      available: true,
      cachedReleases: async () => [release("a"), release("b"), release("c"), release("d")],
      acquire: async (_target: unknown, hash: string) => (tried.push(hash[0]!), acquire(hash[0]!)),
    };
    const playback = new PlaybackService(library as never, {} as never, {} as never, () => settingsSchema.parse({ sourcePriority: ["torbox", "local"] }), () => null, () => ({ requestLink: async () => "https://cdn.torbox.test/2" }) as never, discovery as never, async () => null);
    return { playback, tried };
  };

  test("a release without this in it (a pack of other seasons) is passed over for the next", async () => {
    const { NoPlayableFileError } = await import("../src/sources/discovery");
    const { playback, tried } = withReleases(async (hash) => {
      if (hash === "a") throw new NoPlayableFileError();
      return { status: "ready", fileId: 2 };
    });
    expect((await playback.prepareDownload(movie)).fileId).toBe(2);
    expect(tried).toEqual(["a", "b"]);
  });

  test("when none of the first few has it, the answer says so plainly", async () => {
    const { NoPlayableFileError } = await import("../src/sources/discovery");
    const { playback, tried } = withReleases(async () => {
      throw new NoPlayableFileError();
    });
    await expect(playback.prepareDownload(movie)).rejects.toMatchObject({ status: 404, message: expect.stringContaining("None of the ready copies") });
    expect(tried).toEqual(["a", "b", "c"]);
  });

  test("TorBox failing is a plain message, not an internal error", async () => {
    const { playback } = withReleases(async () => {
      throw new Error("socket hang up");
    });
    await expect(playback.prepareDownload(movie)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("TorBox couldn't get this ready") });
  });
});
