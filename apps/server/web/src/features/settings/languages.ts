/** Languages and countries offered in the settings' dropdowns, named in English ("French", "Portuguese (Brazil)"). */

// "standard" names every variant the same way: "English (United States)", not "American English".
const names = new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "standard" });

/** "fr" → "French", "pt-BR" → "Portuguese (Brazil)"; the code itself when Intl doesn't know it. */
export function languageName(code: string): string {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Subtitle languages (ISO 639-1), as subtitle add-ons know them. */
export const SUBTITLE_LANGUAGES = [
  "ar", "bg", "bn", "bs", "ca", "cs", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fr", "gl", "he", "hi", "hr", "hu", "hy", "id", "is", "it",
  "ja", "ka", "kn", "ko", "lt", "lv", "mk", "ml", "mr", "ms", "nl", "no", "pl", "pt", "ro", "ru", "sk", "sl", "sq", "sr", "sv", "ta", "te", "th", "tl",
  "tr", "uk", "ur", "vi", "zh",
]
  .map((code) => ({ code, name: languageName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Catalog languages (TMDB language tags) TMDB has titles and overviews in. */
export const CATALOG_LANGUAGES = [
  "ar-SA", "bg-BG", "cs-CZ", "da-DK", "de-DE", "el-GR", "en-AU", "en-CA", "en-GB", "en-US", "es-ES", "es-MX", "fi-FI", "fr-CA", "fr-FR", "he-IL", "hi-IN",
  "hr-HR", "hu-HU", "id-ID", "it-IT", "ja-JP", "ko-KR", "ms-MY", "nl-NL", "no-NO", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU", "sk-SK", "sr-RS", "sv-SE",
  "ta-IN", "te-IN", "th-TH", "tr-TR", "uk-UA", "vi-VN", "zh-CN", "zh-HK", "zh-TW",
]
  .map((code) => ({ code, name: languageName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "GB" → "United Kingdom"; the code itself when Intl doesn't know it. */
export function regionName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Countries for release dates and age ratings (ISO 3166-1, as TMDB takes them). */
export const REGIONS = [
  "AE", "AR", "AT", "AU", "BE", "BG", "BR", "CA", "CH", "CL", "CN", "CO", "CZ", "DE", "DK", "EG", "ES", "FI", "FR", "GB", "GR", "HK", "HR", "HU", "ID",
  "IE", "IL", "IN", "IS", "IT", "JP", "KR", "MX", "MY", "NG", "NL", "NO", "NZ", "PE", "PH", "PK", "PL", "PT", "RO", "RS", "RU", "SA", "SE", "SG", "SI",
  "SK", "TH", "TR", "TW", "UA", "US", "VN", "ZA",
]
  .map((code) => ({ code, name: regionName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));
