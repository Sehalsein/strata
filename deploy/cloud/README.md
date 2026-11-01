# Strata in the cloud

The same server as the home build, compiled with `--mode cloud`
(`apps/server/src/mode.ts`): stateless, with everything lasting in Postgres.

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

## Run

```sh
docker build -f deploy/cloud/Dockerfile -t strata-cloud .
docker run -p 8420:8420 \
  -e DATABASE_URL='postgres://user:pass@ep-xxx.neon.tech/strata?sslmode=require' \
  -e STRATA_SECRET_KEY="$(openssl rand -base64 32)" \
  strata-cloud
```

On first start the log prints a **setup code**; the dashboard asks for it when you
create the admin account.

Provider keys (TMDB, TorBox, OMDb) are each household's own, set in the dashboard under
Settings › Connections; the server keeps none for them.

Sign in with Google and passkeys are off unless set up, and the sign-in page only shows
what's on:
- **Google:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (a Google Cloud OAuth client,
  redirect URI `<STRATA_PUBLIC_URL>/api/auth/callback/google`). People connect Google to
  their account first, from the dashboard's account menu; it never creates accounts.
- **Passkeys:** `STRATA_PUBLIC_URL` on HTTPS (browsers only allow passkeys there).

**Email** (for "Forgot password?"): in [Resend](https://resend.com), verify the domain you'll
send from and create an API key with sending access only. Then set `RESEND_API_KEY` and
`STRATA_EMAIL_FROM` (e.g. `Strata <no-reply@yourdomain.com>`, on that domain). Without them
Strata sends no email and the link doesn't show.

**Privacy page** (`/privacy`): set `STRATA_OPERATOR` (who runs the server, e.g. your name
or company) and `STRATA_PRIVACY_CONTACT` (an email address or URL for privacy requests).

Put HTTPS in front (the host's proxy usually does). Several containers can share one
database: migrations take a lock, and sign-ins, settings, TV codes, throttling and the
catalog cache all live in Postgres. Background jobs (TorBox sync) run in each container,
so one is plenty for a household.
