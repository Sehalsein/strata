import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { logger } from "../log";

const log = logger("ffmpeg");

export interface FfmpegInfo {
  ffmpeg: string;
  ffprobe: string;
  version: string;
  /** Hardware H.264 encoder usable for full transcodes, if any. */
  hwEncoder?: "h264_videotoolbox" | "h264_vaapi" | "h264_qsv";
}

function locate(name: string, dataDir: string): string | undefined {
  const candidates = [
    // Strata.app passes its bundled ffmpeg's exact path here.
    process.env[`STRATA_${name.toUpperCase()}`],
    join(dataDir, "bin", name),
    Bun.which(name) ?? undefined,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  return candidates.find((p): p is string => !!p && existsSync(p));
}

export async function detectFfmpeg(dataDir: string): Promise<FfmpegInfo | null> {
  const ffmpeg = locate("ffmpeg", dataDir);
  const ffprobe = locate("ffprobe", dataDir);
  if (!ffmpeg || !ffprobe) {
    log.warn("ffmpeg/ffprobe not found; install ffmpeg (e.g. `brew install ffmpeg`) for remux and probing");
    return null;
  }
  const version = (await run([ffmpeg, "-hide_banner", "-version"])).split("\n")[0]?.replace(/^ffmpeg version /, "").split(" ")[0] ?? "unknown";
  const encoders = await run([ffmpeg, "-hide_banner", "-encoders"]);
  let hwEncoder: FfmpegInfo["hwEncoder"];
  if (platform() === "darwin" && encoders.includes("h264_videotoolbox")) hwEncoder = "h264_videotoolbox";
  else if (platform() === "linux" && existsSync("/dev/dri/renderD128")) {
    if (encoders.includes("h264_qsv")) hwEncoder = "h264_qsv";
    else if (encoders.includes("h264_vaapi")) hwEncoder = "h264_vaapi";
  }
  log.info(`Using ffmpeg ${version} at ${ffmpeg}${hwEncoder ? ` (hw: ${hwEncoder})` : ""}`);
  return { ffmpeg, ffprobe, version, hwEncoder };
}

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}
