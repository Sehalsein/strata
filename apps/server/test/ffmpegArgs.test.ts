import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe } from "../src/media/probe";
import { DEFAULT_CAPS, decide } from "../src/playback/decide";
import { buildHlsArgs } from "../src/playback/ffmpegArgs";

const run = async (cmd: string[]) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  return { code, out };
};

describe("HLS output", () => {
  // A WEBRip whose audio starts 15s in made Apple's player reject the stream: the init
  // segment's audio track was empty because ffmpeg had no audio to describe yet.
  test("audio that starts late still gets a described track and a first segment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strata-hls-"));
    const src = join(dir, "late-audio.mkv");
    const made = await run([
      "ffmpeg", "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=24",
      "-itsoffset", "12", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12",
      "-map", "0:v", "-map", "1:a", "-c:v", "libx265", "-preset", "ultrafast", "-c:a", "eac3", "-ac", "6", src,
    ]);
    expect(made.code).toBe(0);

    const info = await probe("ffprobe", src);
    const plan = decide(info, DEFAULT_CAPS);
    expect(plan.audio).toBe("eac3");
    const out = join(dir, "hls");
    await run(["mkdir", "-p", out]);
    const args = buildHlsArgs({ ffmpeg: "ffmpeg", input: src, startSeconds: 0, plan, info, outDir: out });
    expect((await run(args)).code).toBe(0);

    const first = join(dir, "first.mp4");
    await Bun.write(first, new Blob([await Bun.file(join(out, "init.mp4")).arrayBuffer(), await Bun.file(join(out, "seg00000.m4s")).arrayBuffer()]));
    const streams = await run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,start_time", "-of", "csv=p=0", first]);
    expect(streams.code).toBe(0);
    const lines = streams.out.trim().split("\n");
    expect(lines.map((l) => l.split(",")[0])).toEqual(["hevc", "eac3"]);
    // Both start at the beginning: the gap is filled with silence, not skipped.
    for (const line of lines) expect(Number(line.split(",")[1])).toBeLessThan(0.5);
  }, 60_000);
});
