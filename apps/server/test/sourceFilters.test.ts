import { describe, expect, test } from "bun:test";
import { collapseDuplicates, withFilters } from "../src/sources/sourceFilters";
import type { Candidate } from "../src/sources/resolver";

const GB = 1024 ** 3;
const c = (over: Partial<Candidate>): Candidate => ({ id: "x", fileId: 0, provider: "torbox", name: "n", size: 0, probed: false, availability: "cached", label: "n", originLabel: "TorBox", ...over });
const names = (code: string) => ({ en: "English", fr: "French", ja: "Japanese" })[code] ?? code;

describe("Choose Source's filters", () => {
  const sources = [
    c({ id: "a", resolution: 2160, hdr: "dv", size: 30 * GB, languages: ["en"] }),
    c({ id: "b", resolution: 1080, hdr: null, size: 4 * GB, languages: ["fr"], availability: "uncached" }),
    c({ id: "c", resolution: 1080, hdr: "hdr10", size: 8 * GB, languages: ["multi"] }),
    c({ id: "d", provider: "local", availability: "ready", resolution: 720, probed: true, size: 2 * GB, audio: [{ codec: "aac", channels: 2, language: "jpn" }] }),
  ];

  test("each source is tagged, and the groups say how many each option has", () => {
    const { items, filters } = withFilters(sources, names);
    expect(items.find((i) => i.id === "a")!.filterTags).toEqual(["quality:2160", "ready:now", "hdr:dv", "size:l", "lang:en"]);
    expect(items.find((i) => i.id === "d")!.filterTags).toEqual(["quality:720", "ready:now", "hdr:sdr", "size:s", "lang:ja"]);
    expect(filters.map((g) => [g.title, g.options.map((o) => `${o.label} ${o.count}`)])).toEqual([
      ["Quality", ["4K 1", "1080p 2", "720p and lower 1"]],
      ["Availability", ["Plays now 3"]],
      ["Picture", ["Dolby Vision 1", "HDR 1", "SDR 2"]],
      ["Size", ["Under 5 GB 2", "5–20 GB 1", "Over 20 GB 1"]],
      ["Audio", ["English 1", "French 1", "Japanese 1"]],
    ]);
  });

  test("a group that doesn't tell sources apart isn't offered", () => {
    const { filters } = withFilters([c({ id: "a", resolution: 1080, size: 3 * GB }), c({ id: "b", resolution: 1080, size: 4 * GB })], names);
    expect(filters.map((g) => g.id)).toEqual([]);
  });
});

describe("the same release from several places", () => {
  test("is kept once, the best-ranked, with where else it's offered", () => {
    const out = collapseDuplicates([
      c({ id: "hash:1", releaseTitle: "Movie.2020.1080p.WEB-DL", size: 4 * GB, originLabel: "TorBox", detail: "4.0 GB" }),
      c({ id: "link:1", name: "Movie.2020.1080p.WEB-DL.mkv", size: 4 * GB + 1000, originLabel: "Comet" }),
      c({ id: "link:2", name: "Movie 2020 1080p WEB-DL.mkv", size: 4 * GB, originLabel: "AIOStreams" }),
      c({ id: "link:3", name: "Movie.2020.1080p.WEB-DL.mkv", size: 6 * GB, originLabel: "Comet" }),
      c({ id: "file:9", availability: "ready", name: "Movie.2020.1080p.WEB-DL.mkv", size: 4 * GB, originLabel: "Library" }),
    ]);
    expect(out.map((x) => [x.id, x.detail])).toEqual([
      ["hash:1", "4.0 GB · Also on Comet, AIOStreams"],
      ["link:3", undefined],
      ["file:9", undefined],
    ]);
  });
});
