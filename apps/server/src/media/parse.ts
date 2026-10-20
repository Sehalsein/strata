export interface ParsedName {
  kind: "movie" | "episode";
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  resolution?: number;
  source?: "remux" | "bluray" | "web" | "hdtv" | "dvd" | "cam";
  videoCodec?: "hevc" | "h264" | "av1";
  hdr?: "dv" | "hdr10+" | "hdr10" | "hlg";
  group?: string;
}

export const VIDEO_EXTENSIONS = new Set(["mkv", "mp4", "m4v", "mov", "avi", "ts", "m2ts", "webm", "wmv", "mpg", "mpeg"]);

export function isVideoFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return !!ext && VIDEO_EXTENSIONS.has(ext) && !/\bsample\b/i.test(name);
}

const SEASON_DIR = /^(?:season|series|staffel|saison)[\s._-]*(\d{1,3})$|^s(\d{1,3})$/i;
const SPECIALS_DIR = /^specials?$/i;

const EPISODE_PATTERNS: RegExp[] = [
  /\bS(\d{1,3})[\s._-]?E(\d{1,4})(?:[\s._-]?-?[\s._-]?E(\d{1,4}))?/i,
  /\b(\d{1,2})x(\d{2,3})(?:-?x?(\d{2,3}))?\b/i,
  /\bSeason[\s._-]*(\d{1,3})[\s._-]*Episode[\s._-]*(\d{1,4})/i,
];

const MARKERS: RegExp[] = [
  /\b(?:2160|1080|720|576|480)[pi]\b/i,
  /\b(?:4k|uhd)\b/i,
  /\b(?:cam|hdcam|hdts|telesync|blu-?ray|bdrip|brrip|bdremux|remux|web-?dl|web-?rip|webrip|web|hdtv|dvdrip|dvd|hdrip|amzn|nf|dsnp|hmax|atvp)\b/i,
  /\b(?:x26[45]|h\.?26[45]|hevc|avc|av1|xvid|divx)\b/i,
  /\b(?:hdr10\+?|hdr|dv|dovi|dolby[\s.]?vision|hlg|sdr)\b/i,
  /\b(?:proper|repack|extended|unrated|directors?[\s.]cut|imax|multi|dual)\b/i,
  /\[[^\]]*\]/,
];

export function parseFileName(name: string): ParsedName {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, "");
  const text = base.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();

  let cut = text.length;
  let season: number | undefined;
  let episode: number | undefined;
  let episodeEnd: number | undefined;

  for (const pattern of EPISODE_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      season = Number(m[1]);
      episode = Number(m[2]);
      if (m[3]) episodeEnd = Number(m[3]);
      cut = Math.min(cut, m.index);
      break;
    }
  }

  // A year is a marker unless it is the whole title (e.g. "1917", "2012").
  let year: number | undefined;
  for (const m of text.matchAll(/(?:^|[\s(\[])((?:19|20)\d{2})(?=$|[\s)\]])/g)) {
    const at = m.index! + m[0].indexOf(m[1]!);
    if (at === 0) continue;
    year = Number(m[1]);
    cut = Math.min(cut, at);
    break;
  }

  for (const pattern of MARKERS) {
    const m = pattern.exec(text);
    if (m && m.index > 0) cut = Math.min(cut, m.index);
  }

  const title = cleanTitle(text.slice(0, cut));
  const groupMatch = /-([A-Za-z0-9]+)$/.exec(base);

  return {
    kind: episode !== undefined ? "episode" : "movie",
    title,
    year,
    season,
    episode,
    episodeEnd,
    resolution: detectResolution(text),
    source: detectSource(text),
    videoCodec: detectCodec(text),
    hdr: detectHdr(text),
    group: groupMatch?.[1],
  };
}

/**
 * Parses a file with its parent folders for context. `segments` runs from the media root
 * to the file, e.g. ["Breaking Bad", "Season 2", "03 - Bit by a Dead Bee.mkv"].
 */
export function parseMediaPath(segments: string[], hint: "auto" | "movies" | "shows" = "auto"): ParsedName {
  const fileName = segments[segments.length - 1] ?? "";
  const dirs = segments.slice(0, -1);
  const parsed = parseFileName(fileName);

  // "Season 2/03 - Title.mkv" or "Specials/01.mkv"
  const parentDir = dirs[dirs.length - 1];
  const seasonDir = parentDir ? SEASON_DIR.exec(parentDir) : null;
  const isSpecials = parentDir ? SPECIALS_DIR.test(parentDir) : false;
  if (parsed.kind === "movie" && (seasonDir || isSpecials || hint === "shows")) {
    const ep = /^(?:e|ep|episode)?[\s._-]*(\d{1,3})\b/i.exec(fileName);
    if (ep) {
      parsed.kind = "episode";
      parsed.season = seasonDir ? Number(seasonDir[1] ?? seasonDir[2]) : isSpecials ? 0 : 1;
      parsed.episode = Number(ep[1]);
      parsed.title = "";
    }
  }

  // Episode file names often omit the show ("S01E02.mkv", "03 - Title.mkv"); movie files
  // are often named generically inside a well-named folder. Fall back to the folders.
  const needsFolderTitle =
    !parsed.title || (parsed.kind === "episode" && dirs.length > 0 && seasonDir !== null) || isGenericName(parsed.title);
  if (needsFolderTitle) {
    for (let i = dirs.length - 1; i >= 0; i--) {
      const dir = dirs[i]!;
      if (SEASON_DIR.test(dir) || SPECIALS_DIR.test(dir)) continue;
      const folder = parseFileName(dir);
      if (!folder.title) continue;
      parsed.title = folder.title;
      parsed.year ??= folder.year;
      if (parsed.kind === "episode" && parsed.season === undefined) parsed.season = folder.season;
      break;
    }
  }
  return parsed;
}

const isGenericName = (title: string) => /^(?:movie|video|film|main|feature)$/i.test(title);

function cleanTitle(raw: string): string {
  return raw
    .replace(/[([{]\s*$/, "")
    .replace(/\s*[-–:]\s*$/, "")
    .replace(/^\s*[-–]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectResolution(text: string): number | undefined {
  const m = /\b(2160|1080|720|576|480)[pi]\b/i.exec(text);
  if (m) return Number(m[1]);
  if (/\b(?:4k|uhd)\b/i.test(text)) return 2160;
  return undefined;
}

function detectSource(text: string): ParsedName["source"] {
  if (/\b(?:cam|camrip|hdcam|hd-?ts|telesync|telecine|hd-?tc|hdtc|scr|screener|dvdscr)\b/i.test(text)) return "cam";
  if (/\b(?:bdremux|remux)\b/i.test(text)) return "remux";
  if (/\b(?:blu-?ray|bdrip|brrip)\b/i.test(text)) return "bluray";
  if (/\b(?:web-?dl|web-?rip|webrip|web|amzn|nf|dsnp|hmax|atvp)\b/i.test(text)) return "web";
  if (/\bhdtv\b/i.test(text)) return "hdtv";
  if (/\b(?:dvdrip|dvd)\b/i.test(text)) return "dvd";
  return undefined;
}

function detectCodec(text: string): ParsedName["videoCodec"] {
  if (/\b(?:x265|h\.?265|hevc)\b/i.test(text)) return "hevc";
  if (/\b(?:x264|h\.?264|avc)\b/i.test(text)) return "h264";
  if (/\bav1\b/i.test(text)) return "av1";
  return undefined;
}

function detectHdr(text: string): ParsedName["hdr"] {
  if (/\b(?:dv|dovi|dolby[\s.]?vision)\b/i.test(text)) return "dv";
  if (/\bhdr10\+/i.test(text)) return "hdr10+";
  if (/\bhdr(?:10)?\b/i.test(text)) return "hdr10";
  if (/\bhlg\b/i.test(text)) return "hlg";
  return undefined;
}
