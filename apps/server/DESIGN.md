# Strata Server — Design

Status: draft, pre-implementation (2026-10-20).

Strata Server is a self-hosted media service. It presents one **catalog** (TMDB) and,
for any title, resolves a playable stream from **local files** or **TorBox**. The Apple
app talks only to this server. There is no Jellyfin anywhere in the stack.

## Decisions

| Topic | Decision |
|---|---|
| Runtime | Bun, single process, runs locally (Mac mini first). Cloudflare is not a target for now. |
| Language / libs | TypeScript, Hono (HTTP), Drizzle + `bun:sqlite`, Zod, ffmpeg/ffprobe as external tools. |
| Distribution | One headless `bun build --compile` binary (Jellyfin-style). No native Mac app. |
| Server UI | Web dashboard (React + Vite) embedded in the binary and served at `http://host:port/`. The first visit runs a setup wizard. |
| Users | Household: one admin + profiles (optional PIN), per-profile progress and watchlist. LAN-first; remote via Tailscale or similar. |
| Sources | Local folders + TorBox. TorBox discovery via built-in scrapers (Stremio-addon-style) and TorBox's own search. |
| Player | Apple app keeps AVPlayer. Server direct-plays when possible, otherwise remuxes to HLS with ffmpeg. |
| Jellyfin | Removed. `apps/web` and `apps/tv-android` are frozen (kept, unmaintained). |
| Apple app | Data layer rewritten in place; design system, player chrome and shells are kept. |

## Architecture

```
Apple app ──HTTP/JSON──► Strata Server (one Bun binary)
                           ├─ api/          Hono routes, auth, OpenAPI
                           ├─ catalog/      TMDB fetch + cache, shelves, search
                           ├─ sources/
                           │   ├─ local/    folder scan, filename parse, TMDB match, ffprobe
                           │   ├─ torbox/   library, cache check, add, request link
                           │   └─ scrapers/ stream-addon protocol, TorBox search
                           ├─ resolve/      rank candidates → pick best source
                           ├─ playback/     sessions, direct vs HLS, ffmpeg jobs, progress
                           ├─ jobs/         scheduler: scans, pre-warm, update checks
                           ├─ update/       manifest check, verify, swap, rollback
                           ├─ db/           Drizzle schema + migrations (SQLite)
                           └─ cli/          setup / status / logs / update / uninstall
```

Everything the Apple app sees is keyed by TMDB id. Where a file lives is a server
concern.

## Data directory

The database is embedded: SQLite via `bun:sqlite`, which is part of the Bun runtime inside
the binary. There is no separate database server. The database is created on first run and
migrated automatically on each start.

| Platform | Default location |
|---|---|
| macOS | `~/Library/Application Support/Strata` |
| Linux | `~/.local/share/strata`, or `/var/lib/strata` when installed as a system service |
| Docker | `/data` (mounted volume) |

Override it with `--data-dir` or `STRATA_DATA_DIR`.

```
strata.db (+ -wal, -shm)   SQLite in WAL mode: users, profiles, catalog cache, progress, settings
secret.key                 encrypts the TorBox/TMDB keys stored in the DB
backups/                   automatic DB backup before every migration/update (last N kept)
cache/images/              resized posters and backdrops
cache/transcode/           HLS segments (cleaned when sessions end)
logs/
bin/ffmpeg                 only if downloaded
```

The binary and the data are separate. Updates replace only the binary. Uninstalling leaves
the data unless it is deleted explicitly. The DB must live on a local disk, not an SMB/NFS
share, because SQLite locking over network filesystems is unreliable. Media folders can
be network shares.

## Data model (first cut)

- `users` (admin login), `profiles` (name, avatar, PIN hash, preferences)
- `titles` (tmdb id, type movie|show, cached metadata JSON, imdb id, fetched_at)
- `episodes` (show tmdb id, season, episode, metadata)
- `local_files` (path, size, mtime, parsed name, matched tmdb id/season/episode, probe JSON)
- `torbox_items` (torbox id, hash, file list, matched tmdb ids, cached state)
- `candidates` (resolved source options per title/episode with quality, size, codecs, provider, expiry)
- `progress` (profile, tmdb id, season/episode, position, duration, completed, updated_at)
- `watchlist`, `history`
- `settings` (media folders, TorBox key, source preferences, update channel)

## Source resolution

`find(tmdbId, season?, episode?) → Candidate[]`, `resolve(candidate) → PlayableStream`.

1. **Local**: matched `local_files` rows. Instant, free, preferred by default.
2. **TorBox library**: files already in your TorBox account. Instant.
3. **TorBox cached**: scraper results whose info-hash is cached on TorBox (`checkcached`).
   Resolving adds the torrent (`createtorrent`) and requests a download link (`requestdl`).
4. **TorBox uncached**: shown as "Download", never auto-played.

Ranking comes from per-profile preferences: source priority, max resolution, max size,
HDR/DV preference, audio language, and avoiding codecs that need a full transcode.
The next episode is pre-resolved during playback.

Scrapers need IMDb ids; these come from TMDB `external_ids`.

## Playback

`POST /api/play { tmdbId, season?, episode?, candidateId?, caps }` →
`{ sessionId, mode: "direct" | "hls", url, audioTracks, subtitleTracks, resumeAt }`

The client sends its capabilities (`caps`): containers, video codecs, audio codecs,
HDR/DV support. The server then chooses a mode:

- **direct**: the container and codecs play natively (MP4/MOV, H.264/HEVC, AAC/AC3/EAC3).
  Local files are served with HTTP range support. TorBox links get a 302 redirect.
- **hls remux**: an MKV or another container with compatible codecs.
  ffmpeg runs `-c:v copy` to fMP4 HLS. This is cheap.
- **hls + audio transcode**: DTS/TrueHD is converted to EAC3; video is still copied.
- **hls full transcode**: last resort (e.g. AV1 on old devices). Uses VideoToolbox on macOS.

ffmpeg reads TorBox links directly over HTTP, so nothing is downloaded first.

Subtitles: text subtitles (SRT/ASS) are extracted to WebVTT, which the app already renders.
Image subtitles (PGS/VobSub) need burn-in. That is deferred.

Seeking: the full HLS playlist is generated up front from the duration. A request
for a segment far from the running encoder restarts ffmpeg at that offset
(`-ss`). This is the most complex part of playback.

Progress is reported to `POST /api/progress` every ~10s and on pause/stop.

## API sketch

```
GET  /api/info                         version, apiVersion, update status (no auth)
POST /api/auth/login                   admin/user login → token
GET  /api/profiles  POST /api/profiles/:id/select
GET  /api/home                         shelves: continue, next up, watchlist, trending, local, recently added
GET  /api/search?q=
GET  /api/titles/:type/:tmdbId         detail + availability summary
GET  /api/titles/show/:id/seasons/:n   episodes + per-episode availability
GET  /api/titles/:type/:tmdbId/sources candidates (optional ?season&episode)
POST /api/play                         start session
GET  /api/stream/:session/...          direct bytes or HLS playlist/segments
POST /api/progress   DELETE /api/play/:session
GET/PUT /api/watchlist
GET/PUT /api/admin/settings   POST /api/admin/scan   POST /api/admin/update
```

The OpenAPI spec is generated from the Zod schemas. The Swift client is kept in sync with it.

## Running the server

Like Jellyfin, the server is a headless process configured from a browser.

- Run `strata-server`. It prints `Strata is running at http://192.168.1.20:8420`, and you
  open that address in any browser.
- Works on a Mac, a Linux box, a NAS or a VPS.
- `strata-server service install` registers it with launchd or systemd, so it starts at boot
  and restarts after crashes.
- On macOS the server keeps the machine awake while a stream is active (`caffeinate -w <pid>`).
- On a NAS: run the Docker image, or the Linux binary directly.

## Web dashboard (in the binary)

- **Location**: `apps/server/web`, built with React + Vite. The build output is embedded
  in the compiled binary and served at `/`. The API lives at `/api`.
- **Setup wizard** (first visit, before any admin exists):
  1. Create the admin account.
  2. Add media folders (a server-side folder browser, as in Jellyfin).
  3. Enter the TorBox API key and TMDB key.
  4. Create profiles.
- **Dashboard**:
  - server status
  - active streams (with stop)
  - library scans and unmatched files (manual TMDB fix-up)
  - TorBox status and usage
  - logs
  - update status
- **Settings**:
  - library folders
  - source priority and ranking rules
  - profiles and PINs
  - network (port, bind address, Bonjour)
  - transcoding (hardware acceleration, temp directory, max concurrent)
  - update channel
- Secrets are stored server-side, encrypted at rest with a key in the data directory.
- Watching in the browser is out of scope for now. The dashboard is admin-only.
  `apps/web` could later be revived as a web player against the Strata API.

The server advertises itself over Bonjour (`_strata._tcp`), so the Apple client apps find it
on the LAN automatically.

## Builds and updates

- **Binary**: `bun build --compile` for `darwin-arm64` (today's Mac), plus `linux-x64` and
  `linux-arm64` so a later move to a NAS needs no code changes. The web dashboard is embedded
  in each binary.
- **Docker image** (`linux-x64` and `linux-arm64`): the binary plus ffmpeg. It is the normal
  way to run on Synology, Unraid or TrueNAS.
  - Config via env vars (`STRATA_DATA_DIR`, `STRATA_PORT`).
  - Mounts: `/data` for state, plus media folders.
  - Inside Docker the image tag is the update mechanism; self-update is disabled.
- **Portability rules**:
  - OS-specific behaviour sits behind small adapters:
    - service install: launchd / systemd / none in Docker
    - keep-awake: `caffeinate` / no-op
    - hardware transcoding: VideoToolbox / VAAPI / QSV / software
  - All paths come from config. Nothing assumes macOS.
- **Moving machines**: the whole state is one data directory (SQLite DB, encrypted secrets,
  caches). Copy it to the new machine and update the media folder paths in the dashboard.
  Progress, profiles and TorBox matches carry over. No native npm modules, only `bun:sqlite`.
- **ffmpeg**: uses ffmpeg from `PATH`. If none is found, a pinned static build is downloaded
  into the data directory and checked against its hash.
- **Headless CLI**:
  - `strata-server`: run in the foreground.
  - `strata-server service install|uninstall|status|restart`: register with launchd (per-user
    LaunchAgent) or systemd (user unit; `--system` for a system unit). The service runs a copy
    at `~/.local/bin/strata-server` so self-update can replace it in place.
  - `strata-server update [--check]`, `strata-server --data-dir <path>`.
- **Release CI**: not built yet. Planned to follow dispatch-ai's desktop model: every merge
  ships a nightly (`<next-patch>-nightly.<run>`), a version with no `server-v<version>` tag
  ships a stable release; signed manifests and versioned binaries go to a public Cloudflare
  R2 bucket (`server/`, `server/nightly/`), with `latest/` aliases for an `install.sh`. A
  private GitHub repo can't serve as the feed without a token in every server.
  - No Developer ID signing or notarization. Binaries fetched by `curl` or by the updater
    are not quarantined. Darwin builds are re-signed ad hoc with `codesign --sign -`;
    current macOS kills Bun's linker-signed output on launch. That means darwin builds
    run on a macOS runner.
  - The pieces exist already: `scripts/build.ts --version/--update-url`,
    `scripts/release-manifest.ts` (writes and signs `manifest.json`), `scripts/keygen.ts`.
- **Updates**: the feed base URL is baked in at build time (`STRATA_UPDATE_URL`); the channel
  (`stable`/`nightly`) picks `<base>/manifest.json` or `<base>/nightly/manifest.json`, and an
  `updateManifestUrl` setting can override it. Without either, updates report "not configured".
  1. Verify the Ed25519 signature (key compiled in), the channel, and the SHA-256.
  2. Run the new binary with `--version`; on macOS re-sign it ad hoc first.
  3. Wait until no stream is active.
  4. Back up the DB and write a `pending-update.json` marker.
  5. Swap the binary, keeping `.old`.
  6. Exit with code 75, and the service manager restarts it (in the foreground, the old process
     supervises the new one).
  If the new version fails to boot twice (the marker is cleared after 30 s of uptime), the
  next start restores `.old` and the DB backup. Downgrades are refused, except nightly →
  stable on the stable channel. The dashboard shows "Update available" with an **Update now**
  button, or applies updates automatically if configured to.
- **Client integration**: `/api/info` exposes the server version and API compatibility. The
  Apple client app blocks incompatible servers with a clear message.

## Phases

1. **Foundation**
   - Server skeleton, SQLite, auth + profiles, settings, TMDB catalog.
   - Local scanning and matching, TorBox library sync.
   - Direct play + HLS remux, progress/resume.
   - `/api/info`, compiled binary.
   - Embedded web dashboard: setup wizard, folders, keys, profiles, status.
2. **Discovery and polish**
   - Scrapers + TorBox cache check/add.
   - Ranking preferences, next-episode pre-warm.
   - Subtitle extraction.
   - Full dashboard settings, Bonjour.
   - Headless CLI service install.
   - Release CI + self-update.
3. **Apple app**
   - Replace the Jellyfin data layer with a Strata client.
   - Add a source picker, server version gate, and admin update button.
4. **Later**
   - Promote-to-local downloads, watchlist auto-acquire.
   - Trakt sync.
   - An MPV fallback player, which a cloud deploy would require.

## Open risks

- On-the-fly HLS seeking with ffmpeg is fiddly. Prototype it first, against a real TorBox MKV.
- DV profile 7 (most UHD Blu-ray remuxes) does not play on Apple devices. It needs a
  fallback to the HDR10 base layer or the candidate must be ranked down.
- Public scrapers change or disappear, so they sit behind the provider interface and
  can be swapped.
- TorBox links expire. Sessions must re-resolve when a link fails mid-playback.
