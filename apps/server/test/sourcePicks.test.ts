import { describe, expect, test } from "bun:test";
import { matchScore, rememberedCandidate } from "../src/sourcePicks";
import type { Candidate } from "../src/sources/resolver";

const copy = (id: string, resolution: number, source: Candidate["source"], hdr: string | null = null, videoCodec = "hevc"): Candidate =>
  ({ id, fileId: Number(id.slice(5)), provider: "torbox", name: id, size: 1, resolution, source, hdr, videoCodec, probed: true, availability: "ready", label: id, originLabel: "Library" }) as Candidate;

describe("the copy Play goes back to", () => {
  const uhdRemux = copy("file:1", 2160, "remux", "hdr10");
  const hdWeb = copy("file:2", 1080, "web");
  const hdBluray = copy("file:3", 1080, "bluray");
  const all = [uhdRemux, hdBluray, hdWeb];

  test("the exact copy picked, wherever the server ranks it", () => {
    expect(rememberedCandidate({ candidateId: "file:2" }, all)?.id).toBe("file:2");
  });

  test("a pick that's gone falls back to the show's traits, then to nothing", () => {
    expect(rememberedCandidate({ candidateId: "file:9" }, all)).toBeUndefined();
    expect(rememberedCandidate({ candidateId: "file:9", traits: { resolution: 1080, source: "web" } }, all)?.id).toBe("file:2");
  });

  test("an episode with no pick of its own takes the copy most like the show's", () => {
    expect(rememberedCandidate({ traits: { resolution: 1080, source: "bluray", videoCodec: "hevc" } }, all)?.id).toBe("file:3");
    // Same resolution is required: a 720p pick matches nothing here.
    expect(rememberedCandidate({ traits: { resolution: 720, source: "web" } }, all)).toBeUndefined();
    // Ties keep the server's order.
    expect(rememberedCandidate({ traits: { resolution: 1080 } }, all)?.id).toBe("file:3");
  });

  test("a device's height cap rules out taller copies, even the one picked", () => {
    expect(rememberedCandidate({ candidateId: "file:1" }, all, 1080)).toBeUndefined();
    expect(rememberedCandidate({ candidateId: "file:1", traits: { resolution: 1080, source: "web" } }, all, 1080)?.id).toBe("file:2");
  });

  test("likeness: resolution first, then release type, HDR and codec", () => {
    expect(matchScore({ resolution: 2160, source: "remux", hdr: "hdr10", videoCodec: "hevc" }, uhdRemux)).toBe(8);
    expect(matchScore({ resolution: 1080, source: "web" }, uhdRemux)).toBe(0);
  });
});
