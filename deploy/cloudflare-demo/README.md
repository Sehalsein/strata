# Public demo on Cloudflare

The public demo: a Worker in front of one Cloudflare Container running the [demo server](../../apps/server/scripts/demo/README.md) (`apps/server/scripts/demo/serve.ts --public`) with public-domain clips. Visitors sign in as **demo** / **strata-demo**, a viewer-only account.

## Quick start

From `deploy/cloudflare-demo`:

```sh
bun install
bunx wrangler login                 # once
bunx wrangler secret put TMDB_API_KEY
bunx wrangler secret put DEMO_RESTORE_KEY   # any random 64 hex characters: openssl rand -hex 32
bunx wrangler deploy                # builds the image with Docker and deploys
```

**Local test:** put `TMDB_API_KEY=…` and `DEMO_RESTORE_KEY=…` in `.dev.vars` (ignored by git) and run `bunx wrangler dev`.

## How it works

- **Only viewer requests get through:** sign in, browse, play and save progress. The Worker refuses everything else (admin, setup, release search). The server also refuses admin routes itself (`STRATA_DEMO=1`).
- **Strict limits** live in `src/limits.ts`. One Durable Object counts them, so they hold across all of Cloudflare's locations. Requests over a limit never wake the container.
- **Sign-ins survive sleep.** The container starts from scratch each time it wakes. The Worker remembers each sign-in by its token's hash (never the token) and the profile picked, and restores it in the new container when needed.

The limits cover, per visitor and for the whole demo:

- requests per minute
- sign-ins and plays per hour
- viewers at once
- daily and monthly bandwidth

## Cost

At most one `basic` instance (1/4 vCPU, so waking takes seconds). It sleeps after 5 minutes idle and is billed only while awake.

Worst case, awake all month: about $20 beyond the Workers Paid plan.
