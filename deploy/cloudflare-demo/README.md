# Public demo on Cloudflare

A Worker in front of one Cloudflare Container running the demo server
(`apps/server/scripts/demo/serve.ts --public`) with public-domain clips. Visitors sign in
as **demo / strata-demo**, a viewer-only account.

- **Only viewer requests get through:** sign in, browse, play, save progress. Everything
  else (admin, setup, release search) is refused by the Worker, and admin routes are also
  refused by the server itself (`STRATA_DEMO=1`).
- **Strict limits** (`src/limits.ts`) are counted in one Durable Object, so they hold
  across all of Cloudflare's locations: requests per minute, sign-ins and plays per hour,
  viewers at once, and daily and monthly bandwidth, per visitor and for the whole demo.
  Requests over a limit never wake the container.
- **Sign-ins survive sleep.** The container starts from scratch each time it wakes. The
  Worker remembers each sign-in by its token's hash (never the token) and the profile
  picked, and restores it in the new container on the first request that needs it.
- **Cost:** at most one `basic` instance (1/4 vCPU, so waking takes seconds), asleep after
  5 minutes idle and billed only while awake. Worst case, awake all month: about $20
  beyond the Workers Paid plan.

```sh
bun install
bunx wrangler login                 # once
bunx wrangler secret put TMDB_API_KEY
bunx wrangler secret put DEMO_RESTORE_KEY   # any random 64 hex characters: openssl rand -hex 32
bunx wrangler deploy                # builds the image with Docker and deploys
```

Local test: put `TMDB_API_KEY=…` and `DEMO_RESTORE_KEY=…` in `.dev.vars` (ignored by git) and run `bunx wrangler dev`.
