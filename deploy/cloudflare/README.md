# Strata on Cloudflare Workers

The cloud server: the same code as the home server, running on Workers
(`apps/server/src/worker.ts`) with Neon as its database. Stateless: everything lasting
is in Postgres, so any number of Worker instances serve it.

| | |
|---|---|
| Video | Never through here: the apps play TorBox links directly |
| Database | Neon, connected directly per request (Neon's serverless driver) |
| Dashboard | Static assets served by Cloudflare (`apps/server/web/dist`) |
| Jobs | Cron Triggers: TorBox sync every 15 min, cleanup daily |
| Accounts | Better Auth: invite-only households, TV sign-in by code |
| Cost | Workers Paid ($5/month) + Neon's free tier for a household |

## Deploy

```sh
cd apps/server/web && bun run build          # the dashboard
cd ../../../deploy/cloudflare
npx wrangler secret put DATABASE_URL         # Neon connection string (sslmode=require)
npx wrangler secret put STRATA_SECRET_KEY    # openssl rand -base64 32 — keep it safe
npx wrangler deploy
```

Optional: `STRATA_PUBLIC_URL` (in `wrangler.jsonc` vars) once it has a domain. Provider
keys (TMDB, TorBox, OMDb) are each household's own, set in the dashboard under Settings ›
Connections; the server keeps none for them.

Sign in with Google and passkeys are off unless set up, and the sign-in page only shows
what's on:
- **Google:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (secrets) (a Google Cloud OAuth client,
  redirect URI `<STRATA_PUBLIC_URL>/api/auth/callback/google`). People connect Google to
  their account first, from the dashboard's account menu; it never creates accounts.
- **Passkeys:** `STRATA_PUBLIC_URL` on HTTPS (browsers only allow passkeys there).

On the first request the server creates its tables and logs a **setup code**
(`npx wrangler tail`): the dashboard asks for it to create the server admin. Then add
households (the household switcher at the top of the sidebar) and invite their owners.

`STRATA_SECRET_KEY` encrypts the API keys stored in the database. Keep it the same
across deploys; a different key can't read them (they'd need entering again).
