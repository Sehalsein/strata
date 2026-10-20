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
    return json({ id: 10378, title: "Big Buck Bunny", release_date: "2008-05-30", runtime: 10, genres: [{ id: 16, name: "Animation" }], poster_path: "/bbb.jpg", credits: { cast: [], crew: [] }, recommendations: { page: 1, results: [], total_pages: 1, total_results: 0 } });
  }
  if (path === "/tv/9001") {
    return json({ id: 9001, name: "Test Show", first_air_date: "2020-01-01", genres: [], seasons: [{ season_number: 1, name: "Season 1", episode_count: 2 }] });
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
  if (path.startsWith("/trending/") || path.endsWith("/popular") || path.endsWith("/top_rated")) {
    return json({ page: 1, results: [{ id: 10378, title: "Big Buck Bunny", release_date: "2008-05-30" }], total_pages: 1, total_results: 1 });
  }
  return new Response(JSON.stringify({ status_message: "not found" }), { status: 404 });
}) as typeof fetch;

export interface TestServer {
  services: Services;
  request: (path: string, init?: RequestInit & { json?: unknown; token?: string }) => Promise<Response>;
  dataDir: string;
}

export async function startTestServer(): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), "strata-test-"));
  process.env.TMDB_API_KEY = "test-key";
  const services = await createServices({ dataDir, port: 0, host: "127.0.0.1" }, { fetch: fakeTmdb });
  const app = createApp(services);
  const request = async (path: string, init: RequestInit & { json?: unknown; token?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    let bodyInit = init.body;
    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
      bodyInit = JSON.stringify(init.json);
    }
    return app.fetch(new Request(`http://test${path}`, { ...init, headers, body: bodyInit }));
  };
  return { services, request, dataDir };
}

/** Generates small real media files with ffmpeg (cached between runs). */
export async function makeFixtures(): Promise<string> {
  const root = join(tmpdir(), "strata-fixtures-v1");
  const files: [string, string[]][] = [
    // MKV, H.264 + AC3: plays after a remux to HLS.
    ["Movies/Big Buck Bunny (2008)/Big.Buck.Bunny.2008.1080p.BluRay.x264.mkv", ["-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-c:a", "ac3"]],
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
  return root;
}
