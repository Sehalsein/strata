import { describe, expect, test } from "bun:test";
import { DEFAULT_CAPS, decide } from "../src/playback/decide";
import type { MediaInfo } from "../src/media/probe";
import { detailLabel, rankCandidates, type Candidate } from "../src/sources/resolver";

const media = (over: Partial<Omit<MediaInfo, "video">> & { video?: Partial<NonNullable<MediaInfo["video"]>> } = {}): MediaInfo => ({
  container: "mkv",
  durationMs: 7_200_000,
  audio: [{ index: 1, codec: "eac3", channels: 6, language: "eng", isDefault: true }],
  subtitles: [],
  chapters: [],
  ...over,
  video: { index: 0, codec: "hevc", width: 3840, height: 2160, bitDepth: 10, hdr: "hdr10", ...over.video },
});

describe("decide", () => {
  test("mp4 with supported codecs plays directly", () => {
    expect(decide(media({ container: "mp4" }), DEFAULT_CAPS).mode).toBe("direct");
  });

  test("mkv is remuxed with video copied", () => {
    const plan = decide(media({ audio: [{ index: 1, codec: "aac", channels: 2, isDefault: true }] }), DEFAULT_CAPS);
    expect(plan).toMatchObject({ mode: "remux", video: "copy", audio: "copy" });
  });

  test("Dolby audio is re-encoded rather than copied into HLS", () => {
    // Copying it can leave an empty audio track in the init segment (audio stored late in the file).
    expect(decide(media(), DEFAULT_CAPS)).toMatchObject({ mode: "remux", audio: "eac3" });
    expect(decide(media({ audio: [{ index: 1, codec: "ac3", channels: 6, isDefault: true }] }), DEFAULT_CAPS).audio).toBe("eac3");
    // Direct play keeps the original track.
    expect(decide(media({ container: "mp4" }), DEFAULT_CAPS)).toMatchObject({ mode: "direct", audio: "copy" });
  });

  test("TrueHD/DTS become EAC3 when multichannel", () => {
    const plan = decide(media({ audio: [{ index: 1, codec: "truehd", channels: 8, isDefault: true }] }), DEFAULT_CAPS);
    expect(plan).toMatchObject({ mode: "remux", audio: "eac3" });
  });

  test("Dolby Vision profile 7 keeps the HDR10 base layer", () => {
    const plan = decide(media({ container: "mp4", video: { hdr: "dv", dvProfile: 7 } }), DEFAULT_CAPS);
    expect(plan).toMatchObject({ mode: "remux", stripDolbyVision: true });
  });

  test("Dolby Vision profile 5 transcodes on clients without DV", () => {
    const plan = decide(media({ video: { hdr: "dv", dvProfile: 5 } }), { ...DEFAULT_CAPS, dvProfiles: [] });
    expect(plan.mode).toBe("transcode");
  });

  test("10-bit H.264 and oversize video transcode", () => {
    expect(decide(media({ video: { codec: "h264", bitDepth: 10, height: 1080, width: 1920 } }), DEFAULT_CAPS).mode).toBe("transcode");
    const plan = decide(media(), { ...DEFAULT_CAPS, maxHeight: 1080 });
    expect(plan).toMatchObject({ mode: "transcode", targetHeight: 1080 });
  });

  test("picks audio by preferred language, else default", () => {
    const audio = [
      { index: 1, codec: "aac", channels: 2, language: "jpn", isDefault: true },
      { index: 2, codec: "aac", channels: 2, language: "eng", isDefault: false },
    ];
    expect(decide(media({ audio }), DEFAULT_CAPS, undefined, "en-US").audioStreamIndex).toBe(2);
    expect(decide(media({ audio }), DEFAULT_CAPS).audioStreamIndex).toBe(1);
  });
});

describe("rankCandidates", () => {
  const c = (over: Partial<Candidate>): Candidate => ({ id: "x", fileId: 1, provider: "local", name: "", size: 1, probed: false, availability: "ready", label: "", originLabel: "Library", ...over });

  test("source priority, then resolution, then quality", () => {
    const ranked = rankCandidates(
      [c({ id: "tb4k", provider: "torbox", resolution: 2160 }), c({ id: "local1080", resolution: 1080 }), c({ id: "local4kweb", resolution: 2160, source: "web" }), c({ id: "local4kremux", resolution: 2160, source: "remux" })],
      { sourcePriority: ["local", "torbox"], maxResolution: 2160 },
    );
    expect(ranked.map((r) => r.id)).toEqual(["local4kremux", "local4kweb", "local1080", "tb4k"]);
  });

  test("max resolution demotes but doesn't drop", () => {
    const ranked = rankCandidates([c({ id: "4k", resolution: 2160 }), c({ id: "hd", resolution: 1080 })], { sourcePriority: ["local"], maxResolution: 1080 });
    expect(ranked.map((r) => r.id)).toEqual(["hd", "4k"]);
  });
});

describe("source labels", () => {
  test("detail lines read naturally", () => {
    expect(detailLabel(48318382080, 42)).toBe("45.0 GB · 42 seeders");
    expect(detailLabel(734003200)).toBe("700 MB");
    expect(detailLabel(0, 1)).toBe("1 seeder");
    expect(detailLabel(0)).toBeUndefined();
  });
});
