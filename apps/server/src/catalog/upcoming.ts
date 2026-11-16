import type { AnilistDate, AnilistTitle } from "./anime/anilist";
import type { TmdbMovie, TmdbShow } from "./tmdb";

/**
 * When a title next comes out, in words: a film's next release in the household's region,
 * a show's next episode or premiere. Title pages offer "Remind me" for these, and the
 * calendar notifies people who asked on the day.
 */
export interface Upcoming {
  /** YYYY-MM-DD. */
  date: string;
  /** The exact time, when known (anime, from AniList), as an ISO instant. */
  airsAt: string | null;
  /** What happens, as the page and calendar show it: "In cinemas", "Season 2 premieres". */
  label: string;
  /** The notification's line on the day, after the title: "is in cinemas today". */
  out: string;
}

/** How far ahead a reminder is honoured (the calendar lists reminded titles this far out). */
export const REMINDER_DAYS = 366;

/** The kinds of film release the calendar follows (TMDB's types: theatrical, digital, physical). */
export const RELEASE_TYPES: Record<number, { label: string; out: string }> = {
  3: { label: "In cinemas", out: "is in cinemas today" },
  4: { label: "Out to stream or rent", out: "is out to stream or rent today" },
  5: { label: "Out on disc", out: "is out on disc today" },
};

/** A film's releases in the region (else the US): the earliest day of each kind, in date order. */
export function filmReleases(m: Pick<TmdbMovie, "release_dates">, region: string): { type: number; day: string }[] {
  const results = m.release_dates?.results ?? [];
  const dates = (results.find((r) => r.iso_3166_1 === region.toUpperCase()) ?? results.find((r) => r.iso_3166_1 === "US"))?.release_dates ?? [];
  const byType = new Map<number, string>();
  for (const d of dates) {
    const day = d.release_date?.slice(0, 10);
    if (!day || !RELEASE_TYPES[d.type]) continue;
    if (!byType.has(d.type) || day < byType.get(d.type)!) byType.set(d.type, day);
  }
  return [...byType.entries()].map(([type, day]) => ({ type, day })).sort((a, b) => a.day.localeCompare(b.day));
}

export function movieUpcoming(m: Pick<TmdbMovie, "release_dates" | "release_date">, region: string, today: string): Upcoming | null {
  const next = filmReleases(m, region).find((r) => r.day > today);
  if (next) return { date: next.day, airsAt: null, label: RELEASE_TYPES[next.type]!.label, out: RELEASE_TYPES[next.type]!.out };
  if (m.release_date && m.release_date > today) return { date: m.release_date, airsAt: null, label: "Out", out: "is out today" };
  return null;
}

const premiere = (season: number, episode: number) =>
  episode === 1 ? (season <= 1 ? { label: "Premieres", out: "premieres today" } : { label: `Season ${season} premieres`, out: `season ${season} premieres today` }) : { label: `S${season} E${episode} airs`, out: `S${season} E${episode} airs today` };

export function showUpcoming(s: Pick<TmdbShow, "next_episode_to_air" | "first_air_date">, today: string): Upcoming | null {
  const n = s.next_episode_to_air;
  if (n?.air_date && n.air_date > today) return { date: n.air_date, airsAt: null, ...premiere(n.season_number, n.episode_number) };
  if (s.first_air_date && s.first_air_date > today) return { date: s.first_air_date, airsAt: null, label: "Premieres", out: "premieres today" };
  return null;
}

const fullDate = (d: AnilistDate | null | undefined) => (d?.year && d.month && d.day ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null);

export function anilistUpcoming(m: Pick<AnilistTitle, "nextAiringEpisode" | "startDate">, type: "movie" | "show", now: number): Upcoming | null {
  const today = new Date(now).toISOString().slice(0, 10);
  const next = m.nextAiringEpisode;
  if (type === "show" && next && next.airingAt * 1000 > now) {
    const at = new Date(next.airingAt * 1000);
    const words = next.episode === 1 ? { label: "Premieres", out: "premieres today" } : { label: `Episode ${next.episode} airs`, out: `episode ${next.episode} airs today` };
    return { date: at.toISOString().slice(0, 10), airsAt: at.toISOString(), ...words };
  }
  const start = fullDate(m.startDate);
  if (start && start > today) return { date: start, airsAt: null, ...(type === "movie" ? { label: "Out", out: "is out today" } : { label: "Premieres", out: "premieres today" }) };
  return null;
}

/** What a title page offers: whether they're reminded, and of what. Null: nothing dated to come. */
export const remindOf = (u: Upcoming | null, on: boolean) => (u ? { on, date: u.date, airsAt: u.airsAt, label: u.label } : null);
