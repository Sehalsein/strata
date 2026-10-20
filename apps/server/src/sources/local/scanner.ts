import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { isVideoFile, parseMediaPath } from "../../media/parse";
import type { Library } from "../../library";
import type { MediaFolder } from "../../settings";
import { logger } from "../../log";

const log = logger("scan");
const SKIP_DIRS = new Set(["@eaDir", ".AppleDouble", "$RECYCLE.BIN", "System Volume Information", "lost+found", "extras", "featurettes", "behind the scenes", "deleted scenes", "trailers"]);

export interface ScanResult {
  folders: number;
  files: number;
  missing: number;
  matched: number;
  unmatched: number;
}

export async function scanLocal(
  library: Library,
  folders: MediaFolder[],
  report: (done: number, total: number, label?: string) => void = () => {},
): Promise<ScanResult> {
  const seen: string[] = [];
  for (const folder of folders) {
    try {
      await stat(folder.path);
    } catch {
      log.warn(`Media folder unavailable: ${folder.path}`);
      continue;
    }
    for await (const path of walk(folder.path)) {
      let info;
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      const segments = relative(folder.path, path).split(sep);
      library.upsert({
        provider: "local",
        ref: path,
        name: segments[segments.length - 1]!,
        size: info.size,
        mtime: Math.round(info.mtimeMs),
        parsed: parseMediaPath(segments, folder.kind),
      });
      seen.push(path);
      if (seen.length % 50 === 0) report(seen.length, 0, "Scanning files");
    }
  }
  const missing = library.markMissing("local", seen);
  const { matched, unmatched } = await library.matchPending((done, total) => report(done, total, "Matching titles"));
  library.pruneOrphans();
  log.info(`Scanned ${folders.length} folder(s): ${seen.length} files, ${missing} missing`);
  return { folders: folders.length, files: seen.length, missing, matched, unmatched };
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    log.warn(`Cannot read ${dir}`, err);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !SKIP_DIRS.has(entry.name.toLowerCase())) yield* walk(full);
    } else if (entry.isFile() && isVideoFile(entry.name)) {
      yield full;
    }
  }
}
