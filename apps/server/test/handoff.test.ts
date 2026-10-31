import { describe, expect, test } from "bun:test";
import { capsSchema, type PlaybackPlan } from "../src/playback/decide";
import { PlaybackService, refuseServerStream } from "../src/playback/service";
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

describe("no video through the server", () => {
  const plan = (mode: PlaybackPlan["mode"]): PlaybackPlan => ({ mode, video: "copy", audio: "copy", stripDolbyVision: false, reasons: ["video codec vc1 unsupported"] });
  const caps = (deviceRemux: boolean) => capsSchema.parse({ deviceRemux });

  test("TorBox files play from TorBox, directly or repackaged on the device", () => {
    expect(() => refuseServerStream(plan("direct"), "url", caps(true))).not.toThrow();
    expect(() => refuseServerStream(plan("device"), "url", caps(true))).not.toThrow();
  });

  test("a TorBox file the device can't play isn't streamed by the server instead", () => {
    expect(() => refuseServerStream(plan("transcode"), "url", caps(true))).toThrow(/can't play on this device.*Pick another source/);
    expect(() => refuseServerStream(plan("remux"), "url", caps(false))).toThrow(/Update the Strata app/);
  });

  test("files on the server's disk still stream from it", () => {
    expect(() => refuseServerStream(plan("transcode"), "path", caps(true))).not.toThrow();
  });
});
