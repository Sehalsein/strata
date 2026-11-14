# Strata in the cloud (Docker)

The same server as the home build, compiled with `--mode cloud` (`apps/server/src/mode.ts`). It's stateless: everything lasting is in Postgres. This file is for running it as a container on any host.

To run it on Cloudflare Workers instead, see [deploy/cloudflare](../cloudflare/README.md).

## Quick start

From the repo root:

```sh
docker build -f deploy/cloud/Dockerfile -t strata-cloud .
docker run -p 8420:8420 \
  -e DATABASE_URL='postgres://user:pass@ep-xxx.neon.tech/strata?sslmode=require' \
  -e STRATA_SECRET_KEY="$(openssl rand -base64 32)" \
  strata-cloud
```

On first start the log prints a **setup code**. The dashboard asks for it when you create the admin account.

Put HTTPS in front. The host's proxy usually does this.

## Home server vs cloud server

| | Home server | Cloud server |
|---|---|---|
| Database | Bundled Postgres (PGlite) in the data folder, or `DATABASE_URL` | `DATABASE_URL` (required), e.g. Neon |
| Secret key (encrypts API keys) | `secret.key` beside the data, created on first start | `STRATA_SECRET_KEY` (required) |
| Disk | Data folder | Throwaway caches only |
| Home-network join, Bonjour | Yes | No |
| Local media folders (ffmpeg) | Yes | No |
| Video | TorBox straight to the apps; local files from the server | TorBox straight to the apps only |
| Updates | Self-update | Deploy a new image |
| Client address (throttling) | The connection | `X-Forwarded-For` from the host's proxy |

## Configuration

| Env | Needed for |
|---|---|
| `DATABASE_URL` | Required. The Postgres database. |
| `STRATA_SECRET_KEY` | Required. Encrypts stored API keys. |
| `STRATA_PUBLIC_URL` | The server's address. Passkeys need it on HTTPS (browsers only allow them there). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google |
| `RESEND_API_KEY`, `STRATA_EMAIL_FROM` | Password-reset email |
| `STRATA_OPERATOR`, `STRATA_PRIVACY_CONTACT` | The privacy page |

Provider keys (TMDB, TorBox, OMDb) belong to each household. They're set in the dashboard under Settings › Connections, and the server keeps none of its own.

### Sign in with Google and passkeys

Both are off unless set up, and the sign-in page only shows what's on.

- **Google:** create a Google Cloud OAuth client with the redirect URI `<STRATA_PUBLIC_URL>/api/auth/callback/google`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. People connect Google to their account first, from the dashboard's account menu. It never creates accounts.
- **Passkeys:** set `STRATA_PUBLIC_URL` to an HTTPS address.

### Email

Email is used for "Forgot password?".

1. In [Resend](https://resend.com), verify the domain you'll send from.
2. Create an API key with sending access only.
3. Set `RESEND_API_KEY` and `STRATA_EMAIL_FROM` (e.g. `Strata <no-reply@yourdomain.com>`, on that domain).

Without them Strata sends no email, and the link doesn't show.

### Privacy page

`/privacy` uses `STRATA_OPERATOR` (who runs the server, e.g. your name or company) and `STRATA_PRIVACY_CONTACT` (an email address or URL for privacy requests).

## Running several containers

Several containers can share one database. Migrations take a lock, and sign-ins, settings, TV codes, throttling and the catalog cache all live in Postgres.

Background jobs (TorBox sync) run in every container, so one container is plenty for a household.
