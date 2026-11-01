# Strata Server — Design

Status: implemented; this describes the code as it is (2026-10-31).

Strata Server is a media service. It presents one **catalog** (TMDB) and, for any title,
resolves a playable stream from **local files** or **TorBox**. The Apple apps talk only to
this server. There is no Jellyfin anywhere in the stack.

## Decisions

| Topic | Decision |
|---|---|
| Modes | One codebase, two modes fixed at build time (`src/mode.ts`): **home** (self-hosted, one server per home) and **cloud** (hosted, many households). |
| Runtimes | Bun (home server, cloud container) and Cloudflare Workers (the cloud server). `#runtime` picks `src/runtime/bun.ts` or `src/runtime/workers.ts` per build. |
| Language / libs | TypeScript, Hono (HTTP), Drizzle on Postgres, Better Auth, Zod, ffmpeg/ffprobe as external tools. |
| Database | Postgres. Home: bundled PGlite in the data folder, or any Postgres via `DATABASE_URL`. Cloud: `DATABASE_URL` (Neon). |
| Distribution | Home: the Mac app (Strata.app) and `bun build --compile` binaries for macOS and Linux, with ffmpeg inside. Cloud: deployed to Workers or as a container. No home Docker image. |
| Server UI | Web dashboard (React + Vite) served at `/`. Home: embedded in the binary, first visit runs setup. Cloud: static assets. |
| Accounts | Better Auth. Households are organizations with owner/admin/member roles; a server admin runs the server. |
| Sources | Local folders (home only) + TorBox. TorBox discovery via built-in scrapers (Stremio-addon-style) and TorBox's own search. |
| Player | The Apple apps keep AVPlayer. TorBox files go straight to the app; the server remuxes or transcodes local files when it has to. |
| Jellyfin | Removed, along with the old Jellyfin-based web and Android TV apps. |

## Modes and runtimes

`src/profile.ts` turns mode × runtime into a `DeploymentProfile`: a list of capabilities
(first-run setup, open sign-up, admins by email, local media, Bonjour, home-network join,
self-update, local state, behind a proxy, timers or cron). Code asks the profile for what it
needs, not for the mode. `/api/info` publishes the public part, so the dashboard and apps
don't work it out again.

| | Home | Cloud |
|---|---|---|
| Accounts | Setup makes the server admin; households grow by invitation | Open sign-up with email confirmation; each account gets a household in onboarding |
| Server admin | The account made at setup | Emails in `STRATA_ADMIN_EMAILS` (once confirmed) |
| Database | Bundled PGlite, or `DATABASE_URL` | `DATABASE_URL` (required) |
| Secret key | `secret.key` in the data folder | `STRATA_SECRET_KEY` |
| Local folders, ffmpeg | Yes | No |
| Bonjour, home-network join | Yes | No |
| Jobs | In-process timers | Cron Triggers on Workers |
| Updates | Self-update (binaries) | Deploy a new version |

The public demo runs with the profile marked read-only: nobody may change anything in it.

## Architecture

```
Apple apps ──HTTP/JSON──► Strata Server
                           ├─ api/          Hono app, middleware, routes/
                           ├─ auth/         Better Auth setup + per-path policy, permissions
                           ├─ household.ts  one household's Library, catalog, playback, discovery, TorBox
                           ├─ catalog/      TMDB/OMDb + cache, anime ids, shelves, search, viewer, content ratings
                           ├─ sources/
                           │   ├─ local/    folder scan
                           │   ├─ torbox/   client, library sync, cleanup
                           │   ├─ discovery scrapers + TorBox search, cache check, add
                           │   └─ resolver  candidates and ranking
                           ├─ media/        filename parse (anitomy), ffprobe
                           ├─ playback/     decide, prepare, sessions, plays, ffmpeg args, subtitles
                           ├─ jobs.ts       named jobs; cloudSchedule.ts has the schedule
                           ├─ update/       SelfUpdate: signed manifest, verify, swap, rollback
                           ├─ db/           Drizzle schema + migrations (Postgres)
                           ├─ platform/     ffmpeg, Bonjour, keep-awake, service install, launcher
                           ├─ runtime/      Bun vs Workers
                           ├─ main.ts       Bun entry and CLI
                           └─ worker.ts     Workers entry (fetch + scheduled)
```

Everything the Apple apps see is keyed by TMDB id. Where a file lives is a server concern.

**Households.** `Household` (`src/household.ts`) is one household's Strata over its own
settings and TorBox key: `Library`, catalog, calendar, content filter, discovery, TorBox
housekeeping, playback and its plays, plus upkeep (`syncTorbox`, `cleanTorbox`,
`scanFolders`, `setSecret`). Everything reaches the database through household-scoped
stores, so one household never sees another's data. `Viewer` (`src/catalog/viewer.ts`) is
one person's view of it, with their content limit applied: nothing above the limit leaves
it, so a route can't forget to check.

## Accounts and permissions

Accounts are Better Auth (`src/auth/betterAuth.ts`), built from its plugins and hooks, with
no custom auth endpoints.

- **Households** are organizations. Roles: owner, admin, member. Owners and admins run the
  household in the dashboard; members use the apps to watch.
- **Server admin** runs the server (settings, logs, households, updates). Home: the account
  made at setup (with the setup code from the server's log). Cloud: `STRATA_ADMIN_EMAILS`.
- **Watch-only sessions**: a device that joined on the home network without a password
  (`POST /api/join`), a QR sign-in code from the dashboard, or a TV approved with a device
  code. They can watch and pick a household, but only call an allowlist of Better Auth paths.
- Other ways in, when configured: Google, passkeys (on a public HTTPS address).
- Every Better Auth path's extra rules sit in one `policy` table in `betterAuth.ts`, run
  before and after the path. Who may do what is in `src/auth/permissions.ts`
  (`permissionsOf`), which the API middleware, the auth hooks and `/api/me` all use.

## Data directory

Home servers keep their state in a data folder. Cloud servers keep everything lasting in
Postgres and use the disk only for throwaway caches.

| Platform | Default location |
|---|---|
| macOS | `~/Library/Application Support/Strata` |
| Linux | `$XDG_DATA_HOME/strata` (`~/.local/share/strata`) |

Override it with `--data-dir` or `STRATA_DATA_DIR`.

```
db/                        bundled Postgres (PGlite), unless DATABASE_URL is set
secret.key                 encrypts the TorBox/TMDB/OMDb keys stored in the DB
backups/                   daily DB backups and one before every update (last 10 kept)
cache/transcode/           HLS segments (cleaned when sessions end)
logs/
```

The database is created on first start and migrated on each start. The schema version is
in `strata_meta`; an advisory lock lets one of several servers migrate while the others
wait.

The binary and the data are separate. Updates replace only the binary. Uninstalling leaves
the data unless it is deleted explicitly. Media folders can be network shares.

## Data model

- Better Auth: `user`, `session`, `account`, `verification`, `organization` (households),
  `member` (role, content limit), `invitation`, `device_code`, `passkey`, `rate_limit`
- `settings` (server), `household_settings` (per household; keys encrypted)
- `files` (local and TorBox files: parsed name, matched TMDB id/season/episode, probe)
- `torbox_added` (what Strata added to TorBox, for cleanup)
- `media_items`, `api_cache` (TMDB/OMDb answers shared by all households)
- `progress`, `continue_hidden`, `watchlist`
- `play_sessions`, `auth_attempts`

## Source resolution

`find(tmdbId, season?, episode?) → Candidate[]`, then `prepare()` turns a candidate into a
playback plan.

1. **Local**: matched local files. Instant, free, preferred by default.
2. **TorBox library**: files already in the household's TorBox account. Instant.
3. **TorBox cached**: scraper results whose info-hash is cached on TorBox. Playing adds the
   torrent and requests a download link.
4. **TorBox uncached**: shown as "Download", never auto-played.

Ranking comes from household settings: source priority, max resolution, max release size,
whether to show uncached releases. The next episode is pre-warmed during playback.

Scrapers need IMDb ids; these come from TMDB `external_ids`. Anime adds AniList/Kitsu ids.

## Playback

`POST /api/play { tmdbId, season?, episode?, candidateId?, startMs?, caps }` →
`{ sessionId, mode, url, remux, startOffsetMs, seekToMs, audioTracks, subtitleTracks, … }`

The client sends its capabilities (`caps`): containers, codecs, max height, HDR and Dolby
Vision profiles, and whether it can repackage files itself. `src/playback/decide.ts` picks
a mode:

- **direct**: the container and codecs play natively. TorBox links go to the app as they
  are; local files are served with HTTP range support (`/api/stream/:sid/file`).
- **device**: the app fetches the file and repackages it itself (the plan says how); nothing
  runs on the server. This is how TorBox files play everywhere, and the only way on cloud.
- **remux**: ffmpeg copies the video into fMP4 HLS; audio is copied or converted (e.g.
  DTS/TrueHD to EAC3). Home only.
- **transcode**: last resort. Uses VideoToolbox on macOS, and falls back to software if the
  hardware encoder stalls.

TorBox bytes never pass through the server: the hand-off is the TorBox link itself. An
expired link is refreshed with `POST /api/play/:sessionId/link`. Dolby Vision profile 7 is
played as its HDR10 base layer. When the server can't read a file (Workers have no ffprobe)
it answers 428 and the app probes the file and sends the details.

`PlaybackService` (`src/playback/service.ts`) prepares plays; `SessionManager` keeps every
play on the server; `HouseholdPlays` lets a household see and stop only its own.

Subtitles: text subtitles (SRT/ASS) are converted to WebVTT. Image subtitles (PGS/VobSub)
are not supported yet.

Seeking: an HLS stream starts at the resume point (`startOffsetMs`). A seek outside it
starts a new session at that offset, which replaces the old one.

Progress is reported to `POST /api/progress` during playback and on pause/stop.

## API

The routes are in `src/api/routes`; `src/api/app.ts` mounts them.

```
/api/auth/*                            Better Auth: sign-in/up, sessions, households, members,
                                       invitations, TV device codes, passkeys
GET  /api/info                         version, apiVersion, capabilities (no auth)
POST /api/setup/admin  POST /api/join  first-run admin (home); home-network join
GET  /api/me  /api/me/export  /api/privacy
GET  /api/household/manageable         PATCH /api/household/members/:id
POST /api/household/members/:id/sign-in-code
GET  /api/avatars
GET  /api/home  /api/shows  /api/anime  /api/calendar  /api/search?q=
GET  /api/genres/:type  /api/browse/:type/:list  /api/browse/:type/genre/:id  /api/person/:id
GET  /api/titles/movie/:id  /api/titles/show/:id  /api/titles/show/:id/seasons/:n
GET  /api/sources                      candidates for a title or episode
POST /api/play  POST /api/play/:sid/link  DELETE /api/play/:sid
POST /api/downloads                    a file to keep on the device
POST /api/files/:id/link  GET /api/files/:id/content  POST /api/files/:id/probe
GET  /api/stream/:sid/...              file bytes, HLS playlist/segments, WebVTT subtitles
POST /api/progress  POST /api/watched  DELETE /api/continue/:type/:tmdbId
GET/PUT /api/watchlist
/api/admin/...                         household admins: status, settings, secrets, devices,
                                       files and matching, sessions, jobs, TorBox account
                                       server admin: logs, folder browser, update
```

There is no generated spec. The contract with the Apple apps is checked by
`test/contract.test.ts`: every field in StrataKit's JSON fixtures must still be in the live
response.

## Running the server

Like Jellyfin, a home server is a headless process configured from a browser.

- Run `strata-server`. It prints `Strata is running at http://192.168.1.20:8420`, and you
  open that address in any browser. Or install the Mac app, which runs it for you.
- Works on a Mac, a Linux box or a NAS.
- `strata-server service install` registers it with launchd or systemd, so it starts at boot
  and restarts after crashes.
- On macOS the server keeps the machine awake while a stream is active (`caffeinate`).

## Web dashboard

- **Location**: `apps/server/web`, built with React + Vite. Home: embedded in the binary
  and served at `/`. Cloud: served as static assets. The API lives at `/api`.
- **For admins only.** Household owners and admins run accounts and data there; members
  watch in the apps.
- **Setup** (home, first visit): create the server admin with the setup code from the log.
  Cloud: sign up, confirm the email, and set up a household in onboarding.
- **Household**: overview, library (folders, unmatched files, manual TMDB fix-up), members
  and invitations, devices, settings and keys.
- **Server** (server admin): status, households, logs, updates.
- Secrets are stored server-side, encrypted at rest.
- Watching in the browser is out of scope.

A home server advertises itself over Bonjour (`_strata._tcp`), so the Apple apps find it on
the LAN.

## Jobs

`src/jobs.ts` runs named jobs on demand or on a schedule, never overlapping. The schedule
is one table, `JOB_SCHEDULE` in `src/cloudSchedule.ts`: what each job needs, its interval
on timers (Bun), and its Cron Trigger (Workers). `test/cloudSchedule.test.ts` checks the
crons against `deploy/cloudflare/wrangler.jsonc`. On cloud each job's last run is kept in
the database, since any instance may run it.

| Job | Runs on |
|---|---|
| `scanLocal` | home, every `scanIntervalMinutes` |
| `syncTorbox` | every 15 min (each household at most every `torboxSyncMinutes`) |
| `checkUpdates` | self-updating servers, every 6 h |
| `backupDatabase` | home, daily |
| `pruneAuth`, `cleanTorbox`, `pruneCatalogCache`, `refreshAnimeIds` | daily |

## Builds and updates

- **Binary**: `bun build --compile` for `darwin-arm64`, `linux-x64` and `linux-arm64`
  (`scripts/build.ts`). Each embeds the web dashboard and a pinned ffmpeg/ffprobe. Darwin
  builds are re-signed ad hoc with `codesign --sign -` and must be built on macOS.
- **Mac app** (`apps/macos`): Strata.app runs the server with its own ffmpeg. It is updated
  by installing a new version, not by self-update.
- **Cloud**: `deploy/cloudflare` (the server Worker, Neon), `deploy/cloud` (the same server
  as a container), `deploy/cloudflare-demo` (the public demo: a Worker in front of a
  container), `deploy/landing` (the landing page).
- **Portability rules**:
  - OS- and runtime-specific behaviour sits behind small adapters: `#runtime`, service
    install (launchd / systemd), keep-awake (`caffeinate` / no-op), hardware transcoding.
  - All paths come from config. Nothing assumes macOS.
- **Moving machines**: the whole state of a home server is one data folder. Copy it to the
  new machine and update the media folder paths in the dashboard.
- **ffmpeg**: release binaries carry their own. Otherwise ffmpeg from `PATH`, or a pinned
  static build set up in the data folder and checked against its hash.
- **Headless CLI**:
  - `strata-server` / `strata-server serve`: run in the foreground.
  - `strata-server service install|uninstall|status|restart`.
  - `strata-server update [--check]`, `strata-server version`, `--data-dir <path>`.
- **Release CI** (`.github/workflows/server-release.yml`): every server change merged to
  main ships a nightly (`<next-patch>-nightly.<run>`); a version with no `server-v<version>`
  tag ships a stable release. Binaries and signed manifests are published as GitHub releases
  (`server-nightly`, `server-stable`).
- **Updates** (`src/update`): `SelfUpdate` has two adapters. The compiled binary's checks
  the signed feed, downloads, swaps itself and restarts; a deployed server's (cloud, the Mac
  app) just reports why it can't. The feed base URL is baked in at build time; the channel
  (`stable`/`nightly`) picks the manifest, and an `updateManifestUrl` setting can override it.
  1. Verify the Ed25519 signature (key compiled in), the channel, and the SHA-256.
  2. Run the new binary with `--version`; on macOS re-sign it ad hoc first.
  3. Wait until no stream is active.
  4. Back up the DB and write a `pending-update.json` marker.
  5. Swap the binary, keeping `.old`.
  6. Restart.
  If the new version fails to boot twice (the marker is cleared after 30 s of uptime), the
  next start restores `.old` and the DB backup. Downgrades are refused, except nightly →
  stable on the stable channel. The dashboard shows "Update available" with an **Update now**
  button, or applies updates automatically if configured to.
- **Client integration**: `/api/info` exposes the server version, API compatibility and
  capabilities. The Apple apps block incompatible servers with a clear message.

## Phases

1. **Foundation**: done.
2. **Discovery and polish**: done (scrapers, ranking, pre-warm, subtitle extraction,
   Bonjour, service install, release CI, self-update).
3. **Apple apps**: done (Strata client, source picker, server version gate).
4. **Cloud**: done (Postgres, Better Auth households, Workers + Neon, demo).
5. **Later**
   - Watchlist auto-acquire.
   - Trakt sync.
   - Image subtitles (PGS/VobSub).

## Open risks

- Public scrapers change or disappear, so they sit behind the discovery interface, and one
  that fails is skipped for a while.
- TorBox links expire. Sessions refresh them (`/api/play/:sid/link`) when one fails
  mid-playback.
- Workers: a request's work ends when it answers, so background work keeps the request
  open, and each request opens its own database connection.
