import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/api/app";
import { createServices, type Services } from "../src/services";

process.env.STRATA_NO_JOBS = "1";

/** A TMDB stand-in covering the endpoints Strata calls. */
export const fakeTmdb: typeof fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const path = url.pathname.replace("/3", "");
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  const q = url.searchParams.get("query")?.toLowerCase() ?? "";

  if (path === "/configuration") return json({ images: {} });
  if (path === "/search/movie") {
    const results = q.includes("big buck") ? [{ id: 10378, title: "Big Buck Bunny", release_date: "2008-05-30", poster_path: "/bbb.jpg" }] : [];
    return json({ page: 1, results, total_pages: 1, total_results: results.length });
  }
  if (path === "/search/tv") {
    const results = q.includes("test show") ? [{ id: 9001, name: "Test Show", first_air_date: "2020-01-01", poster_path: "/ts.jpg" }] : [];
    return json({ page: 1, results, total_pages: 1, total_results: results.length });
  }
  if (path === "/movie/10378") {
    return json({ id: 10378, imdb_id: "tt1254207", title: "Big Buck Bunny", release_date: "2008-05-30", runtime: 10, genres: [{ id: 16, name: "Animation" }], poster_path: "/bbb.jpg", credits: { cast: [], crew: [] }, recommendations: { page: 1, results: [], total_pages: 1, total_results: 0 }, videos: { results: [
      { key: "clip1", site: "YouTube", type: "Clip", name: "Opening", official: true },
      { key: "fan", site: "YouTube", type: "Trailer", name: "Fan trailer", official: false },
      { key: "vimeo1", site: "Vimeo", type: "Trailer", name: "Elsewhere", official: true },
      { key: "official", site: "YouTube", type: "Trailer", name: "Official Trailer", official: true },
    ] } });
  }
  if (path === "/tv/9001") {
    return json({ id: 9001, name: "Test Show", first_air_date: "2020-01-01", external_ids: { imdb_id: "tt9000001" }, genres: [], seasons: [{ season_number: 1, name: "Season 1", episode_count: 2 }] });
  }
  if (path === "/tv/9001/season/1") {
    return json({
      id: 1,
      season_number: 1,
      name: "Season 1",
      episodes: [
        { id: 1, season_number: 1, episode_number: 1, name: "Pilot", air_date: "2020-01-01" },
        { id: 2, season_number: 1, episode_number: 2, name: "Second", air_date: "2020-01-08" },
      ],
    });
  }
  if (path === "/search/multi") {
    const results = [
      ...(q.includes("big buck") ? [{ id: 10378, media_type: "movie", title: "Big Buck Bunny", release_date: "2008-05-30" }] : []),
      ...(q.includes("test show") ? [{ id: 9001, media_type: "tv", name: "Test Show", first_air_date: "2020-01-01" }] : []),
    ];
    return json({ page: 1, results, total_pages: 1, total_results: results.length });
  }
  if (path.startsWith("/trending/") || path.endsWith("/popular") || path.endsWith("/top_rated")) {
    return json({ page: 1, results: [{ id: 10378, title: "Big Buck Bunny", release_date: "2008-05-30" }], total_pages: 1, total_results: 1 });
  }
  return new Response(JSON.stringify({ status_message: "not found" }), { status: 404 });
}) as typeof fetch;

export interface TestServer {
  services: Services;
  request: (path: string, init?: RequestInit & { json?: unknown; token?: string; ip?: string }) => Promise<Response>;
  dataDir: string;
}

export async function startTestServer(fetchImpl: typeof fetch = fakeTmdb): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), "strata-test-"));
  process.env.TMDB_API_KEY = "test-key";
  const services = await createServices({ dataDir, port: 0, host: "127.0.0.1" }, { fetch: fetchImpl });
  const app = createApp(services);
  /** `ip` simulates the client address (otherwise the request has none, i.e. not local). */
  const request = async (path: string, init: RequestInit & { json?: unknown; token?: string; ip?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    let bodyInit = init.body;
    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
      bodyInit = JSON.stringify(init.json);
    }
    const env = init.ip ? { requestIP: () => ({ address: init.ip! }) } : {};
    return app.fetch(new Request(`http://test${path}`, { ...init, headers, body: bodyInit }), env);
  };
  return { services, request, dataDir };
}

/** Generates small real media files with ffmpeg (cached between runs). */
export async function makeFixtures(): Promise<string> {
  const root = join(tmpdir(), "strata-fixtures-v2");
  mkdirSync(root, { recursive: true });
  const srt = join(root, "subs.srt");
  if (!existsSync(srt)) await Bun.write(srt, "1\n00:00:01,000 --> 00:00:04,000\nHello from Strata\n\n2\n00:00:20,000 --> 00:00:22,500\nSecond line\n");
  const files: [string, string[]][] = [
    // MKV, H.264 + AC3 + an SRT track: plays after a remux to HLS.
    ["Movies/Big Buck Bunny (2008)/Big.Buck.Bunny.2008.1080p.BluRay.x264.mkv", ["-i", srt, "-map", "0:v", "-map", "1:a", "-map", "2:s", "-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-c:a", "ac3", "-c:s", "srt", "-metadata:s:s:0", "language=eng"]],
    // MP4, H.264 + AAC: direct play.
    ["Shows/Test Show/Season 1/Test.Show.S01E01.720p.WEB.mp4", ["-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-c:a", "aac", "-movflags", "+faststart"]],
    // MKV with DTS: needs audio transcode.
    ["Shows/Test Show/Season 1/Test.Show.S01E02.720p.WEB.mkv", ["-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-c:a", "dca", "-strict", "-2", "-ac", "6"]],
  ];
  for (const [rel, codec] of files) {
    const out = join(root, rel);
    if (existsSync(out)) continue;
    mkdirSync(join(out, ".."), { recursive: true });
    const proc = Bun.spawn(
      ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", ...codec, out],
      { stderr: "pipe" },
    );
    if ((await proc.exited) !== 0) throw new Error(`fixture ${rel}: ${await new Response(proc.stderr).text()}`);
  }
  const sidecar = join(root, "Movies/Big Buck Bunny (2008)/Big.Buck.Bunny.2008.1080p.BluRay.x264.en.forced.srt");
  if (!existsSync(sidecar)) await Bun.write(sidecar, "1\n00:00:02,000 --> 00:00:03,000\nForced sidecar\n");
  return root;
}
