// Builds standalone strata-server binaries with the dashboard embedded.
//
//   bun scripts/build.ts                # this machine's platform only
//   bun scripts/build.ts --all          # every release target
//   bun scripts/build.ts --target bun-linux-x64 --skip-web
//   bun scripts/build.ts --all --version 0.2.0   # stamp a version (release CI does)
//   bun scripts/build.ts --mode cloud    # the stateless cloud server (see src/mode.ts, deploy/cloud)
//   bun scripts/build.ts --update-url https://updates.example.com/server[/nightly]
//                                       # bake the update feed (or STRATA_UPDATE_URL); none = no self-update
//   bun scripts/build.ts --update-url 'https://github.com/o/r/releases/download/server-{channel}' --channel nightly
//                                       # a feed naming {channel} needs the channel given
//   bun scripts/build.ts --no-ffmpeg     # leave ffmpeg out (it's then downloaded on first start)
//
// A home binary is self-contained: the dashboard, the database (PGlite) and ffmpeg are all
// inside. ffmpeg is the pinned, checksummed build in src/platform/ffmpegInstall.ts, fetched
// once into .cache/ffmpeg and embedded gzipped; the server unpacks it on first start.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WEB = join(ROOT, "web");
const DIST = join(WEB, "dist");
const EMBED = join(ROOT, "src", "web", "embedded.ts");
const FFMPEG_EMBED = join(ROOT, "src", "platform", "embeddedFfmpeg.ts");
const FFMPEG_CACHE = join(ROOT, ".cache", "ffmpeg");
const RELEASE_TARGETS = ["bun-darwin-arm64", "bun-linux-x64", "bun-linux-arm64"];

const args = process.argv.slice(2);
const skipWeb = args.includes("--skip-web");
const noFfmpeg = args.includes("--no-ffmpeg");
const versionArg = args.flatMap((a, i) => (a === "--version" && args[i + 1] ? [args[i + 1]!] : []))[0];
if (versionArg && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(versionArg)) throw new Error(`Invalid --version ${versionArg}`);
const updateUrl = args.flatMap((a, i) => (a === "--update-url" && args[i + 1] ? [args[i + 1]!] : []))[0] ?? process.env.STRATA_UPDATE_URL ?? "";
if (updateUrl && !/^https?:\/\/\S+$/.test(updateUrl)) throw new Error(`Invalid update URL ${updateUrl}`);
const channelArg = args.flatMap((a, i) => (a === "--channel" && args[i + 1] ? [args[i + 1]!] : []))[0];
if (channelArg && channelArg !== "stable" && channelArg !== "nightly") throw new Error(`--channel must be stable or nightly`);
const modeArg = args.flatMap((a, i) => (a === "--mode" && args[i + 1] ? [args[i + 1]!] : []))[0] ?? "home";
if (modeArg !== "home" && modeArg !== "cloud") throw new Error("--mode must be home or cloud");
if (updateUrl.includes("{channel}") && !channelArg) throw new Error("An update URL naming {channel} needs --channel");
const targets = args.includes("--all")
  ? RELEASE_TARGETS
  : args.flatMap((a, i) => (a === "--target" && args[i + 1] ? [args[i + 1]!] : [])).concat([]);
if (targets.length === 0) targets.push(`bun-${process.platform}-${process.arch}`);

async function sh(cmd: string[], cwd: string) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
}

/**
 * The pinned ffmpeg and ffprobe for a target ("linux-x64"…), gzipped, in .cache/ffmpeg:
 * downloaded and checked against its SHA-256 the first time, reused after.
 */
async function ffmpegFor(key: string): Promise<{ ffmpeg: string; ffprobe: string } | null> {
  const { BUNDLED_FFMPEG } = await import("../src/platform/ffmpegInstall");
  const build = BUNDLED_FFMPEG.builds[key];
  if (!build) return null;
  const dir = join(FFMPEG_CACHE, BUNDLED_FFMPEG.version, key);
  const out = { ffmpeg: join(dir, "ffmpeg.gz"), ffprobe: join(dir, "ffprobe.gz") };
  if (existsSync(out.ffmpeg) && existsSync(out.ffprobe)) return out;
  mkdirSync(dir, { recursive: true });
  const url = `${BUNDLED_FFMPEG.source}/releases/download/v${BUNDLED_FFMPEG.version}/${build.file}`;
  console.log(`Fetching ffmpeg ${BUNDLED_FFMPEG.version} for ${key}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);
  const body = new Uint8Array(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== build.sha256) throw new Error(`ffmpeg for ${key} doesn't match its checksum (got ${sha256})`);
  const work = mkdtempSync(join(dir, ".unpack-"));
  try {
    await Bun.write(join(work, build.file), body);
    await sh(["tar", "-xJf", build.file], work);
    for (const tool of ["ffmpeg", "ffprobe"] as const) writeFileSync(out[tool], Bun.gzipSync(new Uint8Array(await Bun.file(join(work, tool)).arrayBuffer()), { level: 9 }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

if (!skipWeb && existsSync(join(WEB, "package.json"))) {
  if (!existsSync(join(WEB, "node_modules"))) await sh(["bun", "install", "--frozen-lockfile"], WEB);
  await sh(["bun", "run", "build"], WEB);
}

const stub = readFileSync(EMBED, "utf8");
const ffmpegStub = readFileSync(FFMPEG_EMBED, "utf8");
try {
  if (existsSync(join(DIST, "index.html"))) {
    const files = walk(DIST);
    const lines = ["// Generated by scripts/build.ts — do not commit."];
    files.forEach((file, i) => {
      lines.push(`import f${i} from ${JSON.stringify(relative(join(ROOT, "src", "web"), file).split(sep).join("/"))} with { type: "file" };`);
    });
    lines.push("export const embeddedFiles: Record<string, string> = {");
    files.forEach((file, i) => lines.push(`  ${JSON.stringify(relative(DIST, file).split(sep).join("/"))}: f${i},`));
    lines.push("};");
    writeFileSync(EMBED, lines.join("\n") + "\n");
    console.log(`Embedding ${files.length} dashboard file(s)`);
  } else {
    console.warn("web/dist not found; building without the dashboard");
  }

  const version = versionArg ?? (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string);
  const define = [
    ...(versionArg ? [`--define=STRATA_BUILD_VERSION=${JSON.stringify(versionArg)}`] : []),
    ...(updateUrl ? [`--define=STRATA_UPDATE_URL=${JSON.stringify(updateUrl.replace(/\/+$/, ""))}`] : []),
    ...(channelArg ? [`--define=STRATA_BUILD_CHANNEL=${JSON.stringify(channelArg)}`] : []),
    `--define=STRATA_BUILD_MODE=${JSON.stringify(modeArg)}`,
  ];
  const { BUNDLED_FFMPEG, ffmpegNotice } = await import("../src/platform/ffmpegInstall");
  for (const target of targets) {
    const outfile = join(ROOT, "dist", `strata-server${modeArg === "cloud" ? "-cloud" : ""}-${target.replace(/^bun-/, "")}`);
    // ffmpeg for this target, inside the binary (home only: the cloud plays nothing through it).
    const ffmpeg = modeArg === "home" && !noFfmpeg ? await ffmpegFor(target.replace(/^bun-/, "")) : null;
    if (ffmpeg) {
      const rel = (file: string) => JSON.stringify(relative(join(ROOT, "src", "platform"), file).split(sep).join("/"));
      writeFileSync(
        FFMPEG_EMBED,
        [
          "// Generated by scripts/build.ts — do not commit.",
          `import ffmpeg from ${rel(ffmpeg.ffmpeg)} with { type: "file" };`,
          `import ffprobe from ${rel(ffmpeg.ffprobe)} with { type: "file" };`,
          `export const embeddedFfmpeg: { version: string; ffmpeg: string; ffprobe: string; notice: string } | null = { version: ${JSON.stringify(BUNDLED_FFMPEG.version)}, ffmpeg, ffprobe, notice: ${JSON.stringify(ffmpegNotice())} };`,
        ].join("\n") + "\n",
      );
    } else writeFileSync(FFMPEG_EMBED, ffmpegStub);
    await sh(["bun", "build", "src/main.ts", "--compile", "--minify", "--sourcemap", `--target=${target}`, `--outfile=${outfile}`, ...define], ROOT);
    // Current macOS SIGKILLs Bun's linker-signed output; an explicit ad-hoc signature fixes it.
    if (target.includes("darwin")) {
      if (process.platform !== "darwin") throw new Error("darwin targets must be built on macOS (they need codesign)");
      await sh(["codesign", "--force", "--sign", "-", outfile], ROOT);
    }
    console.log(`Built ${relative(ROOT, outfile)} (${modeArg}, v${version}${ffmpeg ? `, ffmpeg ${BUNDLED_FFMPEG.version} inside` : ", no ffmpeg inside"}${updateUrl ? `, feed ${updateUrl}` : ", no update feed"})`);
  }
} finally {
  writeFileSync(EMBED, stub);
  writeFileSync(FFMPEG_EMBED, ffmpegStub);
}
