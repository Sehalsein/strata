import { describe, expect, test } from "bun:test";
import { addonSubtitles, fetchSubtitleFile, inspectAddon, setResolverForTests, type StreamAddon } from "../src/sources/addons";
import { AddonSubtitleFinder, normalizeLanguage } from "../src/playback/addonSubtitles";
import { toWebVtt } from "../src/playback/webvtt";
import { chooseSubtitle, labelTracks } from "../src/playback/subtitleChoice";

setResolverForTests(async (host) => (host.startsWith("rebound.") ? ["10.0.0.7"] : ["93.184.215.14"]));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const enc = (s: string) => new TextEncoder().encode(s);
const subsAddon = (over: Partial<StreamAddon> = {}): StreamAddon => ({
  id: "os",
  url: "https://subs.example/manifest.json",
  name: "OpenSubtitles v3",
  enabled: true,
  resources: ["subtitles"],
  idPrefixes: null,
  subtitleIdPrefixes: ["tt"],
  catalogs: [],
  kind: "stremio",
  configurable: false,
  allowPrivate: false,
  ...over,
});

describe("WebVTT from add-on files", () => {
  test("SubRip becomes WebVTT, without tags, and in time order", () => {
    const srt = "﻿2\r\n00:00:05,500 --> 00:00:07,000\r\n<i>Second</i>\r\n\r\n1\r\n00:00:01,000 --> 00:00:03,250\r\n{\\an8}First line\r\n<font color=\"red\">and more</font>\r\n";
    expect(toWebVtt(enc(srt))).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:03.250\nFirst line\nand more\n\n00:00:05.500 --> 00:00:07.000\nSecond\n");
  });

  test("WebVTT keeps its cues and drops NOTE blocks", () => {
    const vtt = "WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.000 align:start\nHello\n";
    expect(toWebVtt(enc(vtt))).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n");
  });

  test("ASS dialogue lines, with commas in the text and line breaks", () => {
    const ass = [
      "[Script Info]",
      "Title: x",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Well, hello\\Nthere",
      "Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}",
    ].join("\n");
    expect(toWebVtt(enc(ass))).toBe("WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nWell, hello\nthere\n");
  });

  test("files that aren't UTF-8 are read as Windows-1252", () => {
    // What's left is escaped as cue text: no stray tags, entities or timing arrows.
    expect(toWebVtt(enc("1\n00:00:01,000 --> 00:00:02,000\nTom &amp; Jerry: 3 &lt; 5 --> go\n"))).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nTom &amp; Jerry: 3 &lt; 5 --&gt; go\n");
    const bytes = new Uint8Array([...enc("1\n00:00:01,000 --> 00:00:02,000\nCaf"), 0xe9, 0x0a]);
    expect(toWebVtt(bytes)).toContain("Café");
  });

  test("a file with no cues is refused", () => {
    expect(() => toWebVtt(enc("<html>not found</html>"))).toThrow();
  });
});

describe("subtitle add-ons", () => {
  test("a manifest that only finds subtitles is accepted", async () => {
    const fetchImpl = (async () => json({ id: "org.stremio.opensubtitlesv3", name: "OpenSubtitles v3", resources: ["subtitles"], types: ["movie", "series"], idPrefixes: ["tt"] })) as unknown as typeof fetch;
    expect(await inspectAddon("https://subs.example", fetchImpl)).toMatchObject({ name: "OpenSubtitles v3", resources: ["subtitles"], idPrefixes: null, subtitleIdPrefixes: ["tt"], kind: "stremio" });
  });

  test("subtitles are asked for with the file's name and size", async () => {
    let asked = "";
    const fetchImpl = (async (url: string) => {
      asked = url;
      return json({ subtitles: [{ id: 1, url: "https://dl.example/1.srt", lang: "eng" }, { url: "ftp://nope", lang: "eng" }, { url: "https://dl.example/2.srt" }] });
    }) as unknown as typeof fetch;
    const found = await addonSubtitles(subsAddon(), "series", "tt0944947:1:2", { filename: "Show S01E02.mkv", videoSize: 123 }, fetchImpl);
    expect(asked).toBe("https://subs.example/subtitles/series/tt0944947%3A1%3A2/filename=Show%20S01E02.mkv&videoSize=123.json");
    expect(found).toEqual([
      { id: "1", url: "https://dl.example/1.srt", lang: "eng" },
      { id: undefined, url: "https://dl.example/2.srt", lang: "und" },
    ]);
  });

  test("a subtitle download follows redirects, but never onto the home network", async () => {
    const fetchImpl = (async (url: string) => {
      if (url === "https://dl.example/1") return new Response(null, { status: 302, headers: { Location: "/files/1.srt" } });
      if (url === "https://dl.example/files/1.srt") return new Response("ok");
      if (url === "https://dl.example/bad") return new Response(null, { status: 302, headers: { Location: "https://rebound.example/x" } });
      return new Response("?", { status: 404 });
    }) as unknown as typeof fetch;
    const addon = { url: "https://subs.example/manifest.json", allowPrivate: false };
    expect(new TextDecoder().decode(await fetchSubtitleFile("https://dl.example/1", addon, fetchImpl))).toBe("ok");
    await expect(fetchSubtitleFile("https://dl.example/bad", addon, fetchImpl)).rejects.toThrow("home network");
  });

  test("language codes become ISO 639-1", () => {
    expect(["eng", "pob", "spn", "fre", "EN", "pt_br", "xyz"].map(normalizeLanguage)).toEqual(["en", "pt-BR", "es", "fr", "en", "pt-BR", "xyz"]);
  });
});

describe("finding a title's subtitles", () => {
  const ids = async () => ({ imdb: "tt1:1:2", kitsu: null });

  test("keeps the household's languages, its best few each, in the order it wants them", async () => {
    const subtitles = [
      ...[1, 2, 3, 4].map((n) => ({ url: `https://dl.example/en${n}`, lang: "eng" })),
      { url: "https://dl.example/fr1", lang: "fre" },
      { url: "https://dl.example/de1", lang: "ger" },
      { url: "https://dl.example/en1", lang: "eng" },
    ];
    const fetchImpl = (async () => json({ subtitles })) as unknown as typeof fetch;
    const off = subsAddon({ id: "off", enabled: false });
    const streams = subsAddon({ id: "streams", resources: ["stream"] });
    const finder = new AddonSubtitleFinder(() => [subsAddon(), off, streams], ids, () => ["fr", "en"], fetchImpl);
    const found = await finder.find({ source: "tmdb", mediaType: "episode", titleId: 1, season: 1, episode: 2 });
    expect(found.map((s) => [s.language, s.rank, s.url])).toEqual([
      ["fr", 1, "https://dl.example/fr1"],
      ["en", 1, "https://dl.example/en1"],
      ["en", 2, "https://dl.example/en2"],
      ["en", 3, "https://dl.example/en3"],
    ]);
    expect(found[0]!.source).toBe("OpenSubtitles v3");
  });

  test("an add-on that fails, or doesn't know the id, is left out", async () => {
    const fetchImpl = (async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    const kitsuOnly = subsAddon({ id: "k", subtitleIdPrefixes: ["kitsu"] });
    const finder = new AddonSubtitleFinder(() => [subsAddon(), kitsuOnly], ids, () => ["en"], fetchImpl);
    expect(await finder.find({ source: "tmdb", mediaType: "movie", titleId: 1 })).toEqual([]);
  });

  test("with no subtitle add-ons nothing is asked", async () => {
    let calls = 0;
    const finder = new AddonSubtitleFinder(() => [], async () => (calls++, { imdb: "tt1", kitsu: null }), () => ["en"]);
    expect(finder.active).toBe(false);
    expect(await finder.find({ source: "tmdb", mediaType: "movie", titleId: 1 })).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("hostile subtitle files", () => {
  test("a long line of unclosed brackets converts in linear time", () => {
    const line = "{\\".repeat(200_000) + "<".repeat(200_000);
    const t0 = performance.now();
    expect(toWebVtt(enc(`1\n00:00:01,000 --> 00:00:02,000\nok${line}\n`))).toContain("ok{");
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  test("a subtitle from a home-network add-on may only come from that add-on's own host", async () => {
    const fetchImpl = (async (url: string) => new Response(`from ${new URL(url).host}`)) as unknown as typeof fetch;
    const local = { url: "http://192.168.1.5:7000/manifest.json", allowPrivate: true };
    expect(new TextDecoder().decode(await fetchSubtitleFile("http://192.168.1.5:7000/subs/1.srt", local, fetchImpl))).toBe("from 192.168.1.5:7000");
    await expect(fetchSubtitleFile("http://192.168.1.9/admin", local, fetchImpl)).rejects.toThrow("home network");
  });
});

describe("the subtitle the server turns on", () => {
  const tracks = labelTracks(
    [
      { id: "s3", codec: "subrip", language: "eng", forced: true, isDefault: false, external: false, url: "/s3.vtt" },
      { id: "s4", codec: "subrip", language: "eng", title: "SDH", forced: false, isDefault: false, external: false, url: "/s4.vtt" },
      { id: "s5", codec: "hdmv_pgs_subtitle", language: "fre", forced: false, isDefault: false, external: false, url: null },
      { id: "a0", codec: "webvtt", language: "fr", forced: false, isDefault: false, external: true, url: "/fr.vtt", detail: "OpenSubtitles v3" },
      { id: "a1", codec: "webvtt", language: "pt-BR", forced: false, isDefault: false, external: true, url: "/pt.vtt", detail: "OpenSubtitles v3 · 2" },
      { id: "x0", codec: "srt", forced: false, isDefault: false, external: true, url: "/x0.vtt" },
    ],
    "en-US",
  );

  test("every track gets a label the apps show as it is", () => {
    expect(tracks.map((t) => t.label)).toEqual([
      "English (Forced)",
      "English · SDH",
      "French",
      "French · OpenSubtitles v3",
      "Brazilian Portuguese · OpenSubtitles v3 · 2",
      "Track 6 · External",
    ]);
  });

  test("forced lines in the audio's language always; the rest as the household set it", () => {
    expect(chooseSubtitle(tracks, "eng", "forced", ["fr"])).toBe("s3");
    expect(chooseSubtitle(tracks.slice(1), "eng", "forced", ["fr"])).toBeNull();
    // "foreign": English audio isn't one of the household's languages, so French comes on
    // (the picture track can't be shown here, so the add-on's).
    expect(chooseSubtitle(tracks.slice(1), "eng", "foreign", ["fr"])).toBe("a0");
    expect(chooseSubtitle(tracks.slice(1), "eng", "foreign", ["en", "fr"])).toBeNull();
    expect(chooseSubtitle(tracks.slice(1), "eng", "always", ["en"])).toBe("s4");
    expect(chooseSubtitle(tracks.slice(1), "jpn", "always", ["de"])).toBeNull();
  });
});
