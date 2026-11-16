import { SharedWork } from "../inFlight";
import { logger } from "../log";
import { globalFetch } from "../net";
import { addonSubtitles, findsSubtitles, type AddonSubtitle, type StreamAddon } from "../sources/addons";
import type { TitleTarget } from "../catalog/ref";
import type { AddonHealth } from "../sources/addonHealth";

const log = logger("addon-subtitles");

/** How long a title's subtitles are asked for before playback goes ahead without the slow ones. */
const LOOKUP_BUDGET_MS = 4_000;
/** Kept a while: what's published for a title rarely changes within hours. */
const TTL_MS = 6 * 3_600_000;
/** Subtitles per add-on and language: the best few, so the menu stays short. */
const PER_LANGUAGE = 3;

/** One subtitle an add-on has for what's playing, in a language the household reads. */
export interface OnlineSubtitle {
  addonId: string;
  /** The add-on's name, to tell where it came from ("OpenSubtitles v3"). */
  source: string;
  url: string;
  /** ISO 639-1 where known ("en", "pt-BR"), else as the add-on gave it. */
  language: string;
  /** 1 for its best in this language, 2 for the next… */
  rank: number;
}

/**
 * Asks a household's subtitle add-ons (OpenSubtitles v3 and the like) what they have for a
 * title, keeping the languages the household reads.
 */
export class AddonSubtitleFinder {
  private cache = new SharedWork<string, AddonSubtitle[]>({ remember: true, ttlMs: TTL_MS, max: 500 });

  constructor(
    private readonly addons: () => StreamAddon[],
    private readonly ids: (target: TitleTarget) => Promise<{ imdb: string | null; kitsu: string | null }>,
    /** ISO 639-1 codes, most wanted first. */
    private readonly languages: () => string[],
    private readonly fetchImpl: typeof fetch = globalFetch,
    private readonly health?: AddonHealth,
  ) {}

  /** Whether any add-on is set to find subtitles (so a lookup is worth starting). */
  get active(): boolean {
    return this.addons().some((a) => a.enabled && findsSubtitles(a));
  }

  /**
   * What the add-ons have, in add-on order, then language order. `file` (when known) helps
   * them match the release. Never throws: an add-on that fails or is slow (past the
   * budget) is left out.
   */
  async find(target: TitleTarget, file?: { name: string; size: number }): Promise<OnlineSubtitle[]> {
    const addons = this.addons().filter((a) => a.enabled && findsSubtitles(a));
    if (!addons.length) return [];
    const wanted = this.languages().map(baseLanguage);
    const deadline = AbortSignal.timeout(LOOKUP_BUDGET_MS);
    let ids: { imdb: string | null; kitsu: string | null };
    try {
      ids = await this.ids(target);
    } catch (err) {
      log.debug("No ids for subtitles", err);
      return [];
    }
    const type = target.mediaType === "movie" ? "movie" : "series";
    const extra = { filename: file?.name || undefined, videoSize: file?.size || undefined };
    const perAddon = await Promise.all(
      addons.map(async (addon) => {
        const prefixes = addon.subtitleIdPrefixes;
        const knows = (id: string) => !prefixes || prefixes.some((p) => id.startsWith(p));
        const id = ids.imdb && knows(ids.imdb) ? ids.imdb : ids.kitsu && knows(ids.kitsu) ? ids.kitsu : null;
        if (!id) return [];
        const key = `${addon.id}:${addon.url}:${id}:${extra.filename ?? ""}:${extra.videoSize ?? ""}`;
        const ask = () => addonSubtitles(addon, type, id, extra, this.fetchImpl);
        const lookup = this.cache.get(key, () => (this.health ? this.health.track(addon.id, addon.name, ask) : ask()));
        try {
          const found = await Promise.race([lookup, abortion(deadline)]);
          return pick(addon, found, wanted);
        } catch (err) {
          lookup.catch(() => {});
          log.warn(`${addon.name} had no subtitles for us`, err);
          return [];
        }
      }),
    );
    return perAddon.flat();
  }
}

/** Rejects when the signal fires. */
function abortion(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** The add-on's subtitles in the wanted languages, the first few of each (add-ons list their best first). */
function pick(addon: StreamAddon, found: AddonSubtitle[], wanted: string[]): OnlineSubtitle[] {
  const byLanguage = new Map<string, OnlineSubtitle[]>();
  const seen = new Set<string>();
  for (const s of found) {
    const language = normalizeLanguage(s.lang);
    if (wanted.length && !wanted.includes(baseLanguage(language))) continue;
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    const list = byLanguage.get(language) ?? [];
    if (list.length >= PER_LANGUAGE) continue;
    list.push({ addonId: addon.id, source: addon.name, url: s.url, language, rank: list.length + 1 });
    byLanguage.set(language, list);
  }
  const order = (lang: string) => {
    const at = wanted.indexOf(baseLanguage(lang));
    return at < 0 ? wanted.length : at;
  };
  return [...byLanguage.entries()].sort(([a], [b]) => order(a) - order(b)).flatMap(([, list]) => list);
}

/** "pt-BR" → "pt". */
export const baseLanguage = (code: string) => code.split("-")[0]!.toLowerCase();

/** OpenSubtitles' language codes (ISO 639-2, and a few of its own) as ISO 639-1 / BCP 47. */
const ISO639_2: Record<string, string> = {
  eng: "en", spa: "es", spn: "es", sea: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", pob: "pt-BR", pom: "pt-MZ",
  jpn: "ja", kor: "ko", chi: "zh", zho: "zh", zht: "zh-TW", zhe: "zh", rus: "ru", hin: "hi", ara: "ar", dut: "nl", nld: "nl", swe: "sv",
  nor: "no", nob: "no", dan: "da", fin: "fi", pol: "pl", tur: "tr", gre: "el", ell: "el", heb: "he", tha: "th", vie: "vi", ind: "id",
  may: "ms", msa: "ms", cze: "cs", ces: "cs", slo: "sk", slk: "sk", hun: "hu", rum: "ro", ron: "ro", ukr: "uk", bul: "bg", hrv: "hr",
  scc: "sr", srp: "sr", slv: "sl", est: "et", lav: "lv", lit: "lt", ice: "is", isl: "is", per: "fa", fas: "fa", tam: "ta", tel: "te",
  mal: "ml", ben: "bn", kan: "kn", mar: "mr", urd: "ur", cat: "ca", baq: "eu", eus: "eu", glg: "gl", alb: "sq", sqi: "sq", mac: "mk",
  mkd: "mk", bos: "bs", geo: "ka", kat: "ka", arm: "hy", hye: "hy", tgl: "tl", fil: "tl",
};

export function normalizeLanguage(code: string): string {
  const c = code.trim();
  const lower = c.toLowerCase();
  if (ISO639_2[lower]) return ISO639_2[lower]!;
  const m = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/i.exec(c);
  if (m) return m[2] ? `${m[1]!.toLowerCase()}-${m[2].toUpperCase()}` : m[1]!.toLowerCase();
  return lower || "und";
}
