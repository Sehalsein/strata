import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../log";

const log = logger("ffmpeg");

/**
 * The ffmpeg a server sets up for itself when none is installed: jellyfin-ffmpeg's portable
 * builds (static, with VideoToolbox / VAAPI / QSV), pinned by version and SHA-256 so a
 * download is either exactly this build or nothing. Fetched from the project's own GitHub
 * releases into `<data-dir>/bin`, where `detectFfmpeg` looks first.
 */
export const BUNDLED_FFMPEG = {
  version: "8.1.3-1",
  source: "https://github.com/jellyfin/jellyfin-ffmpeg",
  builds: {
    "darwin-arm64": { file: "jellyfin-ffmpeg_8.1.3-1_portable_macarm64-gpl.tar.xz", sha256: "22445d7299742749ad2eeb9ce87963d50def0357e45b3e6c7b69987c8365dbf6" },
    "linux-x64": { file: "jellyfin-ffmpeg_8.1.3-1_portable_linux64-gpl.tar.xz", sha256: "b86dc023c64a5a9a410e6e3a938a970460214fae78f31c1553c9f88f1c289b6a" },
    "linux-arm64": { file: "jellyfin-ffmpeg_8.1.3-1_portable_linuxarm64-gpl.tar.xz", sha256: "7bc8e8d0986f7f4693f63e9728570f671f07b6e21c05d5465dd7ce461d1631dc" },
  } as Record<string, { file: string; sha256: string }>,
};

export type FfmpegSetup = { state: "idle" } | { state: "downloading" } | { state: "failed"; error: string } | { state: "unsupported" };

export const platformKey = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`;

/**
 * Downloads, verifies and unpacks ffmpeg + ffprobe into `<dataDir>/bin`. Throws on a failed
 * download or a checksum mismatch, leaving nothing behind. Returns false where no build exists.
 */
export async function installFfmpeg(
  dataDir: string,
  fetchImpl: typeof fetch = fetch,
  key = platformKey(),
  builds: Record<string, { file: string; sha256: string }> = BUNDLED_FFMPEG.builds,
): Promise<boolean> {
  const build = builds[key];
  if (!build) return false;
  const bin = join(dataDir, "bin");
  mkdirSync(bin, { recursive: true });
  const work = mkdtempSync(join(bin, ".ffmpeg-"));
  try {
    const url = `${BUNDLED_FFMPEG.source}/releases/download/v${BUNDLED_FFMPEG.version}/${build.file}`;
    log.info(`Setting up ffmpeg ${BUNDLED_FFMPEG.version} (one-time download)`);
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);
    const archive = join(work, build.file);
    await Bun.write(archive, res);
    const sha256 = createHash("sha256").update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest("hex");
    if (sha256 !== build.sha256) throw new Error(`ffmpeg download doesn't match its checksum (got ${sha256})`);

    const tar = Bun.spawn(["tar", "-xJf", archive, "-C", work], { stdout: "ignore", stderr: "pipe" });
    if ((await tar.exited) !== 0) throw new Error(`Couldn't unpack ffmpeg: ${(await new Response(tar.stderr).text()).trim()}`);
    for (const tool of ["ffmpeg", "ffprobe"]) {
      const from = join(work, tool);
      if (!existsSync(from)) throw new Error(`The ffmpeg download has no ${tool}`);
      chmodSync(from, 0o755);
      // Apple silicon won't run a binary without a signature; ad hoc is enough (as for updates).
      if (process.platform === "darwin") {
        const sign = Bun.spawn(["codesign", "--force", "--sign", "-", from], { stdout: "ignore", stderr: "ignore" });
        if ((await sign.exited) !== 0) throw new Error(`Couldn't sign ${tool}`);
      }
      renameSync(from, join(bin, tool));
    }
    writeFileSync(join(bin, "ffmpeg.json"), JSON.stringify({ version: BUNDLED_FFMPEG.version, source: BUNDLED_FFMPEG.source, file: build.file }, null, 2) + "\n");
    log.info(`ffmpeg ${BUNDLED_FFMPEG.version} installed in ${bin}`);
    return true;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
