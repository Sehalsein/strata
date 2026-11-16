import type { PlayResponse, UnlabeledTrack } from "./service";
import { baseLanguage } from "./addonSubtitles";

type Track = PlayResponse["subtitleTracks"][number];

/** The languages subtitles are wanted in, most wanted first: as set, else the household's language. */
export function subtitleLanguagesOf(settings: { subtitleLanguages: string[]; language: string }): string[] {
  return settings.subtitleLanguages.length ? settings.subtitleLanguages : [baseLanguage(settings.language)];
}

/** When subtitles turn on by themselves (a household setting). */
export type AutoSubtitles = "forced" | "foreign" | "always";

/**
 * The name the apps show for each track, ready to display: the language (in the household's
 * language), what the file calls it, Forced, and where it came from. The apps don't work
 * any of it out.
 */
export function labelTracks(tracks: UnlabeledTrack[], uiLanguage: string): Track[] {
  const names = languageNames(uiLanguage);
  return tracks.map((t, i) => {
    const language = t.language ? names(t.language) : undefined;
    let head = t.title?.trim() || language || `Track ${i + 1}`;
    if (t.title?.trim() && language && !head.toLowerCase().includes(language.toLowerCase())) head = `${language} · ${head}`;
    if (t.forced && !/forced/i.test(head)) head += " (Forced)";
    const tail = t.detail ?? (t.external ? "External" : undefined);
    return { ...t, label: tail ? `${head} · ${tail}` : head };
  });
}

/** "eng"/"en"/"pt-BR" in `uiLanguage`'s words ("English", "Brazilian Portuguese"); unknown codes as they are. */
function languageNames(uiLanguage: string): (code: string) => string | undefined {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([uiLanguage, "en"], { type: "language", fallback: "none" });
  } catch {
    display = null;
  }
  return (code) => {
    const c = code.trim();
    if (!c || c.toLowerCase() === "und") return undefined;
    const two = ISO639_2[c.toLowerCase()] ?? c;
    try {
      const name = display?.of(two);
      if (name) return name.charAt(0).toLocaleUpperCase(uiLanguage) + name.slice(1);
    } catch {
      // Not a language tag Intl knows.
    }
    return c;
  };
}

/** Files name languages in ISO 639-2 (both forms); Intl wants 639-1 where there is one. */
const ISO639_2: Record<string, string> = {
  eng: "en", spa: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", jpn: "ja", kor: "ko", chi: "zh", zho: "zh",
  rus: "ru", hin: "hi", ara: "ar", dut: "nl", nld: "nl", swe: "sv", nor: "no", dan: "da", fin: "fi", pol: "pl", tur: "tr", gre: "el",
  ell: "el", heb: "he", tha: "th", vie: "vi", ind: "id", cze: "cs", ces: "cs", hun: "hu", ron: "ro", rum: "ro", ukr: "uk", tam: "ta",
  tel: "te", mal: "ml", ben: "bn", bul: "bg", hrv: "hr", srp: "sr", slv: "sl", slo: "sk", slk: "sk", per: "fa", fas: "fa", may: "ms", msa: "ms",
};

/** A track the apps can show: text they fetch, or one they read from the file (text or pictures). */
const showable = (t: Track) => t.url !== null || t.streamIndex !== undefined;

const sameLanguage = (a: string | undefined, b: string | undefined) => !!a && !!b && baseLanguage(ISO639_2[a.toLowerCase()] ?? a) === baseLanguage(ISO639_2[b.toLowerCase()] ?? b);

/**
 * The track to turn on when playback starts, or null for none:
 * - forced tracks (foreign-dialogue lines) in the audio's language, always;
 * - "foreign": the household's first subtitle language when the audio isn't in one of them;
 * - "always": the household's first subtitle language it has, whatever the audio.
 * Tracks in the file come before add-on ones, as the list has them.
 */
export function chooseSubtitle(tracks: Track[], audioLanguage: string | undefined, mode: AutoSubtitles, languages: string[]): string | null {
  const forced = tracks.find((t) => t.forced && showable(t) && (!audioLanguage || sameLanguage(t.language, audioLanguage)));
  if (forced) return forced.id;
  if (mode === "forced") return null;
  if (mode === "foreign" && (!audioLanguage || languages.some((l) => sameLanguage(l, audioLanguage)))) return null;
  for (const language of languages) {
    const pick = tracks.find((t) => !t.forced && showable(t) && sameLanguage(t.language, language));
    if (pick) return pick.id;
  }
  return null;
}
