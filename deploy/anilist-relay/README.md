# AniList relay

A tiny relay that lets the cloud server reach AniList. AniList blocks Cloudflare Workers' outgoing addresses (a 403 saying "You have been manually blocked"), so the server can't call it directly.

The relay runs on Deno Deploy's free tier and passes the server's AniList requests on, unchanged. The server keeps the rate limit and the cache.

## Setup

1. In Deno Deploy, make a project from `main.ts` here.
2. Set `RELAY_SECRET` on it to a long random string, e.g. `openssl rand -base64 32`.
3. On the Worker, set these as secrets:

```sh
cd deploy/cloudflare
npx wrangler secret put ANILIST_RELAY_URL      # the Deno Deploy project's address
npx wrangler secret put ANILIST_RELAY_SECRET   # the same string as RELAY_SECRET
```

Without both, the server calls AniList directly, as the home server does.
