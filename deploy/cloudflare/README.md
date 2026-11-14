# Strata on Cloudflare Workers

The cloud server: the same code as the home server, running on Workers (`apps/server/src/worker.ts`) with Neon as its database. This file is for deploying and configuring it.

It's stateless. Everything lasting is in Postgres, so any number of Worker instances can serve it.

## Quick start

Every merge to `main` deploys through Cloudflare's Workers Builds. To deploy by hand the first time:

```sh
cd deploy/cloudflare
npx wrangler secret put DATABASE_URL         # Neon connection string (sslmode=require)
npx wrangler secret put STRATA_SECRET_KEY    # openssl rand -base64 32 — keep it safe
DATABASE_URL='postgres://…' bash deploy.sh   # migrate, then deploy
```

Then create the server admin:

1. Run `npx wrangler tail` and make a request. The log shows a **setup code**.
2. Open the dashboard and enter the code to create the server admin.
3. Add households (the household switcher at the top of the sidebar) and invite their owners.

## At a glance

| | |
|---|---|
| Video | Never through here: the apps play TorBox links directly |
| Database | Neon, connected directly per request (Neon's serverless driver) |
| Dashboard | Static assets served by Cloudflare (`apps/server/web/dist`) |
| Jobs | Cron Triggers: TorBox sync every 15 min, cleanup daily |
| Accounts | Better Auth: invite-only households, TV sign-in by code |
| Cost | Workers Paid ($5/month) + Neon's free tier for a household |

## How deploys work

[`deploy.sh`](deploy.sh) does it all:

1. Typechecks the server.
2. Builds the dashboard and bundles the Worker (a broken build stops here, with Neon untouched).
3. Migrates Neon (`apps/server/scripts/migrate.ts`).
4. Deploys the Worker.

Always deploy with `deploy.sh`, not plain `wrangler deploy`. Workers never migrate or check the schema themselves.

The previous Worker runs on the new schema until the deploy is live, so migrations may only add.

### Workers Builds settings

Under Worker `strata` › Settings › Builds:

| Setting | Value |
|---|---|
| Repository, branch | `Sehalsein/strata`, `main`; builds for other branches off |
| Root directory | `/` |
| Build command | (none) |
| Deploy command | `bash deploy/cloudflare/deploy.sh` |
| Build watch paths | `apps/server/**`, `deploy/cloudflare/**`, `package.json`, `bun.lock` |
| Variables | `BUN_VERSION` = `1.2.20`; `DATABASE_URL` (secret) = Neon's pooled connection string |

## Configuration

Set secrets with `npx wrangler secret put <NAME>`. Plain vars live in `wrangler.jsonc`.

| Name | Kind | Needed for |
|---|---|---|
| `DATABASE_URL` | Secret, required | Neon |
| `STRATA_SECRET_KEY` | Secret, required | Encrypting stored API keys |
| `STRATA_PUBLIC_URL` | Var | The server's address: passkeys, Google's callback, email links and the apps' QR codes |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Secrets | Sign in with Google |
| `RESEND_API_KEY` | Secret | Password-reset email, with `STRATA_EMAIL_FROM` (a var) |
| `STRATA_OPERATOR`, `STRATA_PRIVACY_CONTACT` | Secrets | The privacy page |
| `STRATA_ADMIN_EMAILS` | Secret | Emails whose accounts run the server (comma-separated) |
| `SENTRY_DSN` | Secret | Error reports |
| `ANILIST_RELAY_URL`, `ANILIST_RELAY_SECRET` | Secrets | Reaching AniList (see [anilist-relay](../anilist-relay/README.md)) |

Setting up Google, Resend email and the privacy page works the same as for Docker: see [deploy/cloud](../cloud/README.md#sign-in-with-google-and-passkeys). Google and passkeys stay off unless set up, and the sign-in page only shows what's on.

Provider keys (TMDB, TorBox, OMDb) belong to each household. They're set in the dashboard under Settings › Connections, and the server keeps none of its own.

**Keep `STRATA_SECRET_KEY` the same across deploys.** A different key can't read the stored API keys, and they'd need entering again.
