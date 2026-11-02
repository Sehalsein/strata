# AniList relay

AniList blocks Cloudflare Workers' outgoing addresses (a 403 saying "You have been
manually blocked"), so the cloud server can't reach it directly. This relay runs on
Deno Deploy's free tier and passes the server's AniList requests on, unchanged. The
server keeps the rate limit and the cache.

1. In Deno Deploy, make a project from `main.ts` here and set `RELAY_SECRET` (a long
   random string, e.g. `openssl rand -base64 32`).
2. On the Worker, set `ANILIST_RELAY_URL` (the project's address) and
   `ANILIST_RELAY_SECRET` (the same string) as secrets.

Without both, the server calls AniList directly, as the home server does.
