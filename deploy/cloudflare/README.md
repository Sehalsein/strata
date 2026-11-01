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

Every merge to main deploys, through Cloudflare's Workers Builds (nothing runs on GitHub):
[`deploy.sh`](deploy.sh) typechecks, builds the dashboard and bundles the Worker, migrates
Neon (`apps/server/scripts/migrate.ts`), then deploys. Workers never migrate themselves;
one that finds the schema behind its build refuses to start. The previous Worker runs on
the new schema until the deploy is live, so migrations only add.

Workers Builds settings (Worker `strata` › Settings › Builds):

| | |
|---|---|
| Repository, branch | `Sehalsein/strata`, `main`; builds for other branches off |
| Root directory | `/` |
| Build command | (none) |
| Deploy command | `bash deploy/cloudflare/deploy.sh` |
| Build watch paths | `apps/server/*`, `deploy/cloudflare/*`, `package.json`, `bun.lock` |
| Variables | `BUN_VERSION` = `1.2.20`; `DATABASE_URL` (secret) = Neon's pooled connection string |

By hand, the first time:

```sh
cd deploy/cloudflare
npx wrangler secret put DATABASE_URL         # Neon connection string (sslmode=require)
npx wrangler secret put STRATA_SECRET_KEY    # openssl rand -base64 32 — keep it safe
DATABASE_URL='postgres://…' bash deploy.sh   # migrate, then deploy
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

**Email** (for "Forgot password?"): in [Resend](https://resend.com), verify the domain you'll
send from and create an API key with sending access only. Then set `RESEND_API_KEY` and
`STRATA_EMAIL_FROM` (e.g. `Strata <no-reply@yourdomain.com>`, on that domain). Without them
Strata sends no email and the link doesn't show.

**Privacy page** (`/privacy`): set `STRATA_OPERATOR` (who runs the server, e.g. your name
or company) and `STRATA_PRIVACY_CONTACT` (an email address or URL for privacy requests).

On the first request the server creates its tables and logs a **setup code**
(`npx wrangler tail`): the dashboard asks for it to create the server admin. Then add
households (the household switcher at the top of the sidebar) and invite their owners.

`STRATA_SECRET_KEY` encrypts the API keys stored in the database. Keep it the same
across deploys; a different key can't read them (they'd need entering again).
