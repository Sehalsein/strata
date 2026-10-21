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
- **Cost:** at most one `lite` instance, asleep after 5 minutes idle (billed only while
  awake). Worst case, awake all month: about $4.60 beyond the Workers Paid plan.

```sh
bun install
bunx wrangler login                 # once
bunx wrangler secret put TMDB_API_KEY
bunx wrangler deploy                # builds the image with Docker and deploys
```

Local test: put `TMDB_API_KEY=…` in `.dev.vars` (ignored by git) and run `bunx wrangler dev`.
