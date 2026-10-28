# Strata Server

A self-hosted media server. You browse one catalog (from TMDB), and each title plays from
your local folders or your TorBox account. It runs headless and is configured from a web
dashboard in your browser. See [DESIGN.md](DESIGN.md) for the architecture.

## Install

Prebuilt binaries for Linux (x64, arm64) and macOS (Apple silicon), with the dashboard built
in and automatic updates available, are on the
[releases page](https://github.com/Sehalsein/strata/releases). On a home server:

```sh
curl -fLo strata-server https://github.com/Sehalsein/strata/releases/download/server-stable/strata-server-linux-x64
chmod +x strata-server
sudo ./strata-server service install --system   # macOS: ./strata-server service install
```

Then open `http://<server>:8420` to run setup. ffmpeg comes with it (set up on first start).
On Linux, `sudo apt install avahi-utils` lets the apps find the server on the network.

Other builds: `strata-server-linux-arm64`, `strata-server-darwin-arm64`. For the nightly
channel, download from `server-nightly` instead of `server-stable`. Each of those releases
has a `SHA256SUMS` to check the download against.

## Run

```sh
./strata-server                      # http://localhost:8420; the first visit runs setup
./strata-server --port 9000 --data-dir /srv/strata
./strata-server --version
./strata-server help
```

| Option | Env | Default |
|---|---|---|
| `--port` | `STRATA_PORT` | `8420` |
| `--host` | `STRATA_HOST` | `0.0.0.0` |
| `--data-dir` | `STRATA_DATA_DIR` | `~/Library/Application Support/Strata` (macOS), `~/.local/share/strata` (Linux) |
| `--web-dir` | `STRATA_WEB_DIR` | embedded dashboard |
| | `TMDB_API_KEY`, `TORBOX_API_KEY` | override keys saved in the dashboard |
| | `STRATA_DOCKER=1` | disables self-update (the image tag is the update mechanism) |
| | `STRATA_DEBUG=1` | debug logging (includes ffmpeg command lines) |

ffmpeg and ffprobe (for probing, remuxing and transcoding) come with it: the server looks in
`<data-dir>/bin`, `$PATH`, `/opt/homebrew/bin` and `/usr/local/bin`, and when there's none it
sets up its own on first start, a one-time download of
[jellyfin-ffmpeg](https://github.com/jellyfin/jellyfin-ffmpeg) (static, with VideoToolbox,
VAAPI and QSV) into `<data-dir>/bin`, pinned by version and SHA-256
(`src/platform/ffmpegInstall.ts`). An ffmpeg already on the machine is used instead.
`STRATA_NO_FFMPEG_DOWNLOAD=1` turns the download off.

Port and bind address are deliberately CLI/env-only (the dashboard shows them read-only), so
a settings change can never cut the dashboard off. The server advertises itself on the LAN
as `_strata._tcp` (TXT `version`, `api`, `id`) through `dns-sd` on macOS or
`avahi-publish-service` on Linux (`apt install avahi-utils`); turn it off under
Settings → Network. `id` is a stable per-install id kept in `<data-dir>/server-id` and also
returned by `GET /api/info`.

## Run as a service

```sh
./strata-server service install [--port 8420] [--host 0.0.0.0] [--data-dir PATH]
./strata-server service status
./strata-server service restart
./strata-server service uninstall          # leaves the data dir and binary in place
./strata-server service install --dry-run  # print the plist/unit, change nothing
```

`install` copies the running binary to `~/.local/bin/strata-server` (unless it already runs
from there) so self-update can replace it in place, then registers that copy with the
port/host/data dir given at install time:

- **macOS**: a per-user LaunchAgent, `~/Library/LaunchAgents/com.strata.server.plist`
  (`RunAtLoad`, `KeepAlive`), loaded with `launchctl bootstrap gui/$UID`. stdout/stderr go to
  `<data-dir>/logs/service.{out,err}.log`; the server's own log is `<data-dir>/logs/strata.log`.
- **Linux**: a systemd user unit, `~/.config/systemd/user/strata-server.service`, enabled with
  `systemctl --user enable --now`. User services stop at logout unless you run
  `sudo loginctl enable-linger $USER`. Logs: `journalctl --user -u strata-server`.
- **Linux, system-wide**: `sudo ./strata-server service install --system [--user NAME]` writes
  `/etc/systemd/system/strata-server.service`, runs as `NAME` (default: the sudo user), keeps the
  binary at `/usr/local/lib/strata/strata-server` (owned by that user, for self-update) and the
  data in `/var/lib/strata` unless `--data-dir` is given. Without root it prints the `sudo`
  command instead of escalating.

The service manager restarts the server when it exits; self-update relies on that (exit code 75).

## Updates

Two channels, **stable** and **nightly** (Settings → Updates). The server polls a signed
`manifest.json` for its channel every 6 hours and on **Check now**. With **Install updates
automatically** off (the default) the dashboard shows "Update available" and an **Update**
button.

Where the manifest lives:

- **Built-in feed.** `scripts/build.ts --update-url <base>` (or `STRATA_UPDATE_URL` at build
  time) bakes a feed into the binary: stable reads `<base>/manifest.json`, nightly
  `<base>/nightly/manifest.json`. A base ending in `/nightly` marks a nightly build, which also
  makes nightly its default channel.
- **Override.** Settings → Updates → Advanced → *Manifest URL override* (`updateManifestUrl`);
  `{channel}` is replaced with the channel. Handy for testing against a local server.
- **Neither** (any build without `--update-url`, e.g. `bun run build`): the Updates card says
  "Updates not configured" and nothing is fetched.

The manifest is `{ version, channel, publishedAt, minClientApi, platforms: { "darwin-arm64":
{ url, sha256, size }, … } }`, and `manifest.json.sig` next to it holds a base64 Ed25519
signature over its exact bytes. The server only accepts manifests signed with the key compiled
into it (`src/update/publicKey.ts`) and for the channel it asked for, so the host serving them
doesn't need to be trusted and no token is involved.

Applying an update: download the platform binary to `<binary>.new` → verify size and SHA-256
→ ad-hoc `codesign` it (macOS) → run it with `--version` to make sure it starts → wait until
no stream is playing → back up the DB to `<data-dir>/backups/` → write
`<data-dir>/pending-update.json` → move the running binary to `<binary>.old` and the new one into
place → exit and get restarted. In the foreground (no service manager) the old process stays
on as a small supervisor that starts the new binary in the same terminal.

If the new version fails to start twice (it hasn't stayed up for 30 seconds), the next start
restores `<binary>.old` and the DB backup, records the failure in `<data-dir>/last-update.json`
(shown in the dashboard), and automatic updates skip that version.

Downgrades are refused, with one exception: a nightly build on the stable channel is offered
the stable release even though semver ranks it lower (that is how you leave nightly). If that
release can't open a database a nightly already migrated, it fails to start and the rollback
above puts the nightly back.

From the command line: `strata-server update --check` reports, `strata-server update` installs
immediately (it can't see active streams from there) and restarts the service if one is
installed. Self-update is disabled when running from source and with `STRATA_DOCKER=1`.

### Signing a release by hand

```sh
bun scripts/keygen.ts --private-out ~/strata-update.key --write-public   # once; commits nothing secret
bun scripts/build.ts --all --version 0.2.0 --update-url https://updates.example.com/server
bun scripts/release-manifest.ts --version 0.2.0 --channel stable --dir dist \
  --base-url https://updates.example.com/server --out dist/feed --key-file ~/strata-update.key
# upload dist/strata-server-<platform> as <base>/strata-server-0.2.0-<platform>,
# then dist/feed/manifest.json and manifest.json.sig (binaries first)
```

The public key in `src/update/publicKey.ts` is compiled into every binary; commit it. The
private key (base64 PKCS#8 DER from keygen, or a PEM block) must never be committed; keep an
offline backup, since without it no update will be accepted by existing servers.
`release-manifest.ts` refuses to sign with a key that doesn't match the embedded public key.

### Releases

`.github/workflows/server-release.yml` publishes GitHub releases (the repository is public, so
servers download them without a login):

- **Nightly** on every server change merged to `main`: version `<next patch>-nightly.<run>`,
  in the rolling `server-nightly` prerelease.
- **Stable** when `apps/server/package.json` has a version with no `server-v<version>` tag: a
  `server-v<version>` release with the binaries, and its manifest in the rolling
  `server-stable` release. To ship one, bump that version and merge.

Builds use the feed `https://github.com/Sehalsein/strata/releases/download/server-{channel}`
(`--update-url … --channel <channel>`), so a server reads `server-<channel>/manifest.json`.
Manifests are signed in CI with `STRATA_UPDATE_PRIVATE_KEY`, a secret of the
`server-release` environment, which only `main` can deploy to; signing only runs when
publishing. A manual run (Actions → Server Release) builds without signing or publishing
unless *Publish* is ticked. `.github/workflows/server-ci.yml` typechecks, tests and
build-checks every server change.

## Develop

```sh
cd apps/server
bun install
bun run dev          # API on :8420 with --watch, data in ./.data
cd web && bun install && bun run dev   # dashboard on Vite, proxies /api to :8420
bun test             # unit + API tests (generates small ffmpeg fixtures in $TMPDIR)
bun run typecheck
```

## Build

```sh
bun run build                 # this platform → dist/strata-server-<os>-<arch>
bun scripts/build.ts --all    # darwin-arm64, linux-x64, linux-arm64
bun scripts/build.ts --skip-web --version 0.2.0   # reuse web/dist; stamp a version
bun scripts/build.ts --update-url https://updates.example.com/server   # bake an update feed
```

The build compiles the dashboard (`web/`), embeds `web/dist` in the binary, compiles with
`bun build --compile`, and re-signs darwin builds ad hoc. Without that re-sign, current
macOS kills them on launch.

## Phase 1 status

Working and covered by tests:
- setup wizard API, login, profiles with PINs
- settings, with encrypted secrets
- TMDB catalog: home shelves, browse, search, movie/show/season detail
- local folder scan with filename parsing and TMDB matching, plus manual fix-up
- TorBox library sync
- source ranking
- direct play with byte ranges; HLS remux, audio transcode and full transcode
  (VideoToolbox / VAAPI / QSV / x264)
- resume, progress, Continue Watching, Next Up, watchlist
- keep-awake on macOS while streaming

Known gaps:
- The TorBox integration has only been exercised against the API docs, not a live account.
- HLS uses an EVENT playlist that grows as ffmpeg works. Seeking past what has been produced
  means starting a new play session at that `startMs`, and the client offsets its timeline
  by `startOffsetMs`. With stream copy, the real start snaps to the previous keyframe
  (up to ~1 segment early).
- Subtitles are not served yet (tracks are listed in the play response).
- The HLS output has been validated with ffprobe/ffmpeg, but not yet on a real AVPlayer device.
- Phase 2 (done): Bonjour, self-update with rollback, `service install`.
  Still planned: release CI and the update feed, a downloaded ffmpeg, the Docker image.
