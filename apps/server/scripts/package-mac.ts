// Packages Strata for the Mac the way Jellyfin ships: a Strata.app you drag to
// Applications. Opening it runs the server in the background with a menu bar item
// (Open Dashboard, Show Logs, Quit). No Dock icon, nothing set to start at login.
//
//   bun scripts/package-mac.ts                       # build the server, then the app + DMG
//   bun scripts/package-mac.ts --skip-build          # reuse dist/strata-server-darwin-arm64
//   FFMPEG_DIR=/path/to/static/ffmpeg bun scripts/package-mac.ts
//                                                    # bundle ffmpeg + ffprobe (static builds)
//   STRATA_SIGN_IDENTITY="Developer ID Application: …" bun scripts/package-mac.ts
//                                                    # sign for other Macs (default: ad hoc)
//
// Output: dist/Strata.app and dist/Strata-<version>.dmg
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const LAUNCHER = join(ROOT, "..", "macos", "StrataLauncher");
const ICON_SOURCE = join(ROOT, "..", "apple", "Resources", "Assets.xcassets", "AppIcon.appiconset", "icon-ios-1024.png");
const SERVER = join(DIST, "strata-server-darwin-arm64");
const APP = join(DIST, "Strata.app");

const args = process.argv.slice(2);
const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;

async function sh(cmd: string[], cwd = ROOT) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
}

if (process.platform !== "darwin") throw new Error("Packaging the Mac app needs macOS (swiftc, iconutil, hdiutil).");
if (!args.includes("--skip-build")) await sh(["bun", "scripts/build.ts"]);
if (!existsSync(SERVER)) throw new Error(`Missing ${SERVER}; run bun scripts/build.ts first.`);

// 1. Bundle layout
rmSync(APP, { recursive: true, force: true });
const contents = join(APP, "Contents");
const macos = join(contents, "MacOS");
const resources = join(contents, "Resources");
mkdirSync(macos, { recursive: true });
mkdirSync(resources, { recursive: true });

writeFileSync(join(contents, "Info.plist"), readFileSync(join(LAUNCHER, "Info.plist"), "utf8").replaceAll("__VERSION__", version));

// 2. The menu bar launcher and the server binary side by side
await sh(["swiftc", "-O", "-swift-version", "6", "-target", "arm64-apple-macos14", join(LAUNCHER, "main.swift"), "-o", join(macos, "Strata")]);
cpSync(SERVER, join(macos, "strata-server"));
chmodSync(join(macos, "strata-server"), 0o755);

// 3. ffmpeg: bundled when FFMPEG_DIR points at static ffmpeg/ffprobe builds; otherwise the
//    server falls back to one installed on the Mac (Homebrew) and the dashboard says if none is found.
const ffmpegDir = process.env.FFMPEG_DIR;
if (ffmpegDir) {
  const dest = join(resources, "ffmpeg");
  mkdirSync(dest, { recursive: true });
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const source = join(ffmpegDir, tool);
    if (!existsSync(source)) throw new Error(`FFMPEG_DIR has no ${tool}`);
    cpSync(source, join(dest, tool));
    chmodSync(join(dest, tool), 0o755);
  }
  console.log(`Bundled ffmpeg from ${ffmpegDir}`);
} else {
  console.log("No FFMPEG_DIR: Strata.app will use ffmpeg installed on the Mac (e.g. Homebrew).");
}

// 4. Icon: the app icon at every size macOS asks for
const iconset = join(DIST, "AppIcon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  await sh(["sips", "-z", String(size), String(size), ICON_SOURCE, "--out", join(iconset, `icon_${size}x${size}.png`)]);
  await sh(["sips", "-z", String(size * 2), String(size * 2), ICON_SOURCE, "--out", join(iconset, `icon_${size}x${size}@2x.png`)]);
}
await sh(["iconutil", "-c", "icns", iconset, "-o", join(resources, "AppIcon.icns")]);
rmSync(iconset, { recursive: true, force: true });

// 5. Sign: ad hoc runs on this Mac; other Macs need a Developer ID (and notarization).
const identity = process.env.STRATA_SIGN_IDENTITY ?? "-";
const options = identity === "-" ? [] : ["--options", "runtime", "--timestamp"];
for (const binary of [join(resources, "ffmpeg", "ffmpeg"), join(resources, "ffmpeg", "ffprobe"), join(macos, "strata-server")]) {
  if (existsSync(binary)) await sh(["codesign", "--force", "--sign", identity, ...options, binary]);
}
await sh(["codesign", "--force", "--sign", identity, ...options, APP]);

// 6. Disk image with the usual drag-to-Applications layout
const staging = join(DIST, "dmg");
const dmg = join(DIST, `Strata-${version}.dmg`);
rmSync(staging, { recursive: true, force: true });
rmSync(dmg, { force: true });
mkdirSync(staging);
cpSync(APP, join(staging, "Strata.app"), { recursive: true });
symlinkSync("/Applications", join(staging, "Applications"));
await sh(["hdiutil", "create", "-volname", "Strata", "-srcfolder", staging, "-ov", "-format", "UDZO", dmg]);
rmSync(staging, { recursive: true, force: true });

console.log(`\nBuilt ${APP}\n      ${dmg}`);
