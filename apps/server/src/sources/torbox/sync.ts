import { isVideoFile, parseMediaPath } from "../../media/parse";
import type { Library } from "../../library";
import { logger } from "../../log";
import type { TorboxClient, TorboxKind } from "./client";

const log = logger("torbox");
const KINDS: TorboxKind[] = ["torrents", "usenet", "webdl"];

export function torboxRef(kind: TorboxKind, itemId: number, fileId: number) {
  return `${kind}:${itemId}:${fileId}`;
}

export function parseTorboxRef(ref: string): { kind: TorboxKind; itemId: number; fileId: number } {
  const [kind, itemId, fileId] = ref.split(":");
  if (!KINDS.includes(kind as TorboxKind) || !itemId || !fileId) throw new Error(`Bad TorBox ref ${ref}`);
  return { kind: kind as TorboxKind, itemId: Number(itemId), fileId: Number(fileId) };
}

/** Mirrors the video files of every finished TorBox download into the library. */
export async function syncTorbox(client: TorboxClient, library: Library, report: (done: number, total: number, label?: string) => void = () => {}) {
  const seen: string[] = [];
  const listed: TorboxKind[] = [];
  let items = 0;
  for (const kind of KINDS) {
    let list;
    try {
      list = await client.list(kind);
    } catch (err) {
      // One failing category (e.g. usenet on a plan without it) shouldn't hide the rest.
      if (kind === "torrents") throw err;
      log.warn(`Listing ${kind} failed`, err);
      continue;
    }
    listed.push(kind);
    for (const item of list) {
      if (!(item.download_present || item.download_finished)) continue;
      items++;
      for (const file of item.files ?? []) {
        const path = file.name.includes("/") ? file.name : `${item.name}/${file.short_name ?? file.name}`;
        const segments = path.split("/").filter(Boolean);
        if (!isVideoFile(segments[segments.length - 1] ?? "")) continue;
        const ref = torboxRef(kind, item.id, file.id);
        library.upsert({ provider: "torbox", ref, name: segments[segments.length - 1]!, size: file.size, parsed: parseMediaPath(segments) });
        seen.push(ref);
      }
    }
    report(items, 0, `Listed ${kind}`);
  }
  let missing = 0;
  for (const kind of listed) missing += library.markMissing("torbox", seen, `${kind}:`);
  const { matched, unmatched } = await library.matchPending((done, total) => report(done, total, "Matching titles"));
  library.pruneOrphans();
  log.info(`Synced ${items} TorBox item(s): ${seen.length} video files`);
  return { items, files: seen.length, missing, matched, unmatched };
}
