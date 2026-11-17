// Which requests the public demo answers, and how each counts against the limits.

export type Kind = "api" | "signin" | "play" | "stream";

/** Signing in with a password (Better Auth); and the Apple TV's code sign-in, which the TV asks to start. */
export const SIGN_IN = /^\/api\/auth\/(sign-in\/(username|email)|device\/code)$/;

/**
 * What the demo answers, and how each request counts: what the Strata apps need to sign in,
 * browse, play and keep progress. Everything else is refused, including changing the shared
 * accounts (name, picture, password), joining without a password and anything admin.
 */
export function classify(method: string, url: URL): Kind | null {
  const p = url.pathname;
  if (method === "GET") {
    // Library files: played straight from the server, and downloaded for offline.
    if (p.startsWith("/api/stream/") || /^\/api\/files\/\d+\/content$/.test(p)) return "stream";
    if (p === "/api/sources" && url.searchParams.has("discover")) return null; // release search
    if (/^\/api\/(info|me|home|home\/catalog|home\/profile|watchlist|search|sources|shows|movies|calendar|anime|anime\/categories|avatars)$/.test(p)) return "api";
    if (/^\/api\/anime\/list\/[a-z]{1,20}$/.test(p)) return "api";
    // A row's See All ("/api/rows/home/because%3Amovie%3A27205"), and add-on subtitles.
    if (/^\/api\/rows\/[a-z]{1,20}\/[A-Za-z0-9%:._-]{1,200}$/.test(p)) return "api";
    if (/^\/api\/subtitles\/[A-Za-z0-9_-]{1,4096}\.vtt$/.test(p)) return "api";
    if (/^\/api\/(genres|browse|titles|person)\//.test(p)) return "api";
    if (/^\/api\/avatars\/[a-z0-9-]+\.png$/.test(p)) return "api";
    if (/^\/api\/auth\/(get-session|organization\/list|device)$/.test(p)) return "api";
    return null;
  }
  if (method === "POST") {
    if (SIGN_IN.test(p)) return "signin";
    if (p === "/api/play" || p === "/api/downloads") return "play";
    // Progress, the copy played (so Play goes back to it), and how a play went.
    if (/^\/api\/(progress|watched|play\/pick|play\/report)$/.test(p)) return "api";
    if (/^\/api\/(play\/[A-Za-z0-9-]{8,64}\/link|files\/\d+\/(probe|link))$/.test(p)) return "api";
    // Signing out, picking the household, and the TV's code sign-in (it polls for its token
    // every few seconds; a phone signed in to the demo approves or denies it).
    if (/^\/api\/auth\/(sign-out|organization\/set-active|device\/(token|approve|deny))$/.test(p)) return "api";
    return null;
  }
  if (method === "PUT" && (p === "/api/watchlist" || p === "/api/reminders")) return "api";
  if (method === "DELETE" && /^\/api\/(play\/[A-Za-z0-9-]{8,64}|continue\/(movie|show)\/\d+|continue\/(tmdb|anilist):(movie|show):\d+)$/.test(p)) return "api";
  return null;
}
