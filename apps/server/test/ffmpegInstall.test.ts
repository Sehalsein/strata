import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_FFMPEG, installFfmpeg, platformKey } from "../src/platform/ffmpegInstall";

/** A tar.xz like jellyfin-ffmpeg's portable builds: ffmpeg and ffprobe at the top level. */
async function fakeArchive(): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "strata-ffsrc-"));
  for (const tool of ["ffmpeg", "ffprobe"]) writeFileSync(join(dir, tool), `#!/bin/sh\necho ${tool}\n`);
  const out = join(dir, "build.tar.xz");
  const tar = Bun.spawn(["tar", "-cJf", out, "-C", dir, "ffmpeg", "ffprobe"]);
  expect(await tar.exited).toBe(0);
  return new Uint8Array(readFileSync(out));
}

const serving = (body: Uint8Array, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe("installFfmpeg", () => {
  test("pins a checksum for every release platform", () => {
    for (const key of ["darwin-arm64", "linux-x64", "linux-arm64"]) {
      expect(BUNDLED_FFMPEG.builds[key]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(platformKey("linux", "x64")).toBe("linux-x64");
  });

  test("downloads, verifies and unpacks ffmpeg and ffprobe into <data-dir>/bin", async () => {
    const archive = await fakeArchive();
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const dataDir = mkdtempSync(join(tmpdir(), "strata-ff-"));
    const ok = await installFfmpeg(dataDir, serving(archive), "test-os", { "test-os": { file: "build.tar.xz", sha256 } });
    expect(ok).toBe(true);
    for (const tool of ["ffmpeg", "ffprobe"]) {
      const path = join(dataDir, "bin", tool);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).mode & 0o111).toBeGreaterThan(0);
    }
    expect(JSON.parse(readFileSync(join(dataDir, "bin", "ffmpeg.json"), "utf8")).version).toBe(BUNDLED_FFMPEG.version);
  });

  test("refuses a download that doesn't match its checksum, leaving nothing behind", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "strata-ff-"));
    const install = installFfmpeg(dataDir, serving(await fakeArchive()), "test-os", { "test-os": { file: "build.tar.xz", sha256: "0".repeat(64) } });
    await expect(install).rejects.toThrow(/checksum/);
    expect(existsSync(join(dataDir, "bin", "ffmpeg"))).toBe(false);
    expect(existsSync(join(dataDir, "bin", "ffprobe"))).toBe(false);
  });

  test("a failed download throws; an unsupported platform is a no-op", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "strata-ff-"));
    await expect(installFfmpeg(dataDir, serving(new Uint8Array(), 404), "test-os", { "test-os": { file: "x", sha256: "0".repeat(64) } })).rejects.toThrow(/404/);
    expect(await installFfmpeg(dataDir, serving(new Uint8Array()), "plan9-mips")).toBe(false);
  });
});
