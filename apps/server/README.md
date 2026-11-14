# Strata Server

The self-hosted server behind Strata. You browse one catalog (from TMDB), and each title plays from your local folders or your TorBox account. It runs headless and you configure it from a web dashboard.

This file covers installing, running, updating and building it. The architecture is in [DESIGN.md](DESIGN.md).

## Quick start

```sh
./strata-server            # http://localhost:8420; the first visit runs setup
```

Get `strata-server` from [Install](#install) below, or run it from source (see [Develop](#develop)).

## Install

Prebuilt binaries for Linux (x64, arm64) and macOS (Apple silicon) are on the [releases page](https://github.com/Sehalsein/strata/releases). They include the dashboard and can update themselves.

### Mac

Download [Strata.dmg](https://github.com/Sehalsein/strata/releases/download/server-stable/Strata.dmg), drag Strata to Applications and open it. It runs from the menu bar, starts at login, sets up ffmpeg and updates itself. Or use Homebrew:

```sh
brew tap sehalsein/strata https://github.com/Sehalsein/strata
brew trust sehalsein/strata   # Homebrew asks before loading casks from other taps
brew install --cask strata
```

### Linux (or a Mac without the app)

```sh
curl -fLo strata-server https://github.com/Sehalsein/strata/releases/download/server-stable/strata-server-linux-x64
chmod +x strata-server
sudo ./strata-server service install --system   # macOS: ./strata-server service install
```

Then open `http://<server>:8420` to run setup. ffmpeg is set up on first start.

On Linux, `sudo apt install avahi-utils` lets the apps find the server on your network.

### Other builds

| File | Platform |
|---|---|
| `strata-server-linux-x64` | Linux, x64 |
| `strata-server-linux-arm64` | Linux, arm64 |
| `strata-server-darwin-arm64` | macOS, Apple silicon |

For the nightly channel, download from `server-nightly` instead of `server-stable`. Each release has a `SHA256SUMS` file to check the download against.

## Run

```sh
./strata-server
./strata-server --port 9000 --data-dir /srv/strata
./strata-server --version
./strata-server help
```

| Option | Env | Default |
|---|---|---|
| `--port` | `STRATA_PORT` | `8420` |
| `--host` | `STRATA_HOST` | `0.0.0.0` |
| `--data-dir` | `STRATA_DATA_DIR` | `~/Library/Application Support/Strata` (macOS), `~/.local/share/strata` (Linux) |
| `--web-dir` | `STRATA_WEB_DIR` | The embedded dashboard |
| `--database-url` | `DATABASE_URL` | The bundled database in the data folder |
| | `STRATA_DEBUG=1` | Off. Turns on debug logging, including ffmpeg command lines. |
| | `STRATA_NO_FFMPEG_DOWNLOAD=1` | Off. Stops a source run from downloading ffmpeg. |

Port and bind address are set only on the command line or in env, never in the dashboard (it shows them read-only). That way a settings change can't cut the dashboard off.

API keys (TMDB, TorBox, and optionally OMDb for IMDb and Rotten Tomatoes ratings) are entered in the dashboard.

## Run as a service

```sh
./strata-server service install [--port 8420] [--host 0.0.0.0] [--data-dir PATH]
./strata-server service status
./strata-server service restart
./strata-server service uninstall          # leaves the data dir and binary in place
./strata-server service install --dry-run  # print the plist/unit, change nothing
```

`install` copies the running binary to `~/.local/bin/strata-server` (unless it already runs from there), so self-update can replace it. It registers that copy with the port, host and data dir you give.

| Platform | What it sets up | Logs |
|---|---|---|
| macOS | A per-user LaunchAgent, `~/Library/LaunchAgents/com.strata.server.plist` (`RunAtLoad`, `KeepAlive`), loaded with `launchctl bootstrap gui/$UID` | `<data-dir>/logs/service.{out,err}.log`, and the server's own `<data-dir>/logs/strata.log` |
| Linux | A systemd user unit, `~/.config/systemd/user/strata-server.service`, enabled with `systemctl --user enable --now` | `journalctl --user -u strata-server` |
| Linux, system-wide | `sudo ./strata-server service install --system [--user NAME]` writes `/etc/systemd/system/strata-server.service` | |

Notes:

- Linux user services stop at logout unless you run `sudo loginctl enable-linger $USER`.
- A system-wide service runs as `NAME` (default: the sudo user). It keeps the binary at `/usr/local/lib/strata/strata-server` (owned by that user, for self-update) and data in `/var/lib/strata` unless you pass `--data-dir`.
- Without root, `--system` prints the `sudo` command instead of escalating.
- The service manager restarts the server when it exits. Self-update relies on that (exit code 75).

## Updates

There are two channels, **stable** and **nightly**, chosen under Settings → Updates. The server checks for updates every 6 hours and when you press **Check now**.

**Install updates automatically** is off by default. Until you turn it on, the dashboard shows "Update available" and an **Update** button.

From the command line:

```sh
strata-server update --check   # report only
strata-server update           # install now and restart the service, if there is one
```

`update` from the command line can't see active streams. Self-update is off when running from source.

### How an update is applied

1. Download the platform binary to `<binary>.new` and check its size and SHA-256.
2. Ad-hoc `codesign` it (macOS) and run it with `--version` to make sure it starts.
3. Wait until no stream is playing, then back up the database to `<data-dir>/backups/`.
4. Write `<data-dir>/pending-update.json`, move the running binary to `<binary>.old` and the new one into place.
5. Exit and get restarted. Without a service manager, the old process stays on as a small supervisor that starts the new binary in the same terminal.

**Rollback:** if the new version fails to start twice (it doesn't stay up for 30 seconds), the next start restores `<binary>.old` and the database backup. The failure is recorded in `<data-dir>/last-update.json` (shown in the dashboard), and automatic updates skip that version.

**Downgrades** are refused, with one exception: a nightly build on the stable channel is offered the stable release, which is how you leave nightly. If that release can't open a database the nightly already migrated, it fails to start and the rollback puts the nightly back.

### Where updates come from

The server reads a signed `manifest.json` for its channel:

- **Built-in feed.** `scripts/build.ts --update-url <base>` (or `STRATA_UPDATE_URL` at build time) bakes a feed into the binary. Stable reads `<base>/manifest.json`, nightly `<base>/nightly/manifest.json`. A base ending in `/nightly` marks a nightly build, which also makes nightly its default channel.
- **Override.** Settings → Updates → Advanced → *Manifest URL override* (`updateManifestUrl`). `{channel}` is replaced with the channel. Handy for testing against a local server.
- **Neither** (any build without `--update-url`, such as `bun run build`): the Updates card says "Updates not configured" and nothing is fetched.

The manifest looks like this:

```
{ version, channel, publishedAt, minClientApi, platforms: { "darwin-arm64": { url, sha256, size }, … } }
```

`manifest.json.sig` next to it holds a base64 Ed25519 signature over the manifest's exact bytes. The server only accepts manifests signed with the key compiled into it (`src/update/publicKey.ts`) and for the channel it asked for. So the host serving them doesn't need to be trusted, and no token is involved.

## Develop

```sh
cd apps/server
bun install
bun run dev          # API on :8420 with --watch, data in ./.data
bun test             # unit + API tests (generates small ffmpeg fixtures in $TMPDIR)
bun run typecheck
```

For the dashboard, run `bun install && bun run dev` in `web/` too. It runs on Vite and proxies `/api` to `:8420`. See [web/README.md](web/README.md).

Run from source, the server looks for ffmpeg in `<data-dir>/bin`, `$PATH`, `/opt/homebrew/bin` and `/usr/local/bin`. If there's none, it downloads the same build the binaries bundle (unless `STRATA_NO_FFMPEG_DOWNLOAD=1`).

## Build

```sh
bun run build                 # this platform → dist/strata-server-<os>-<arch>
bun scripts/build.ts --all    # darwin-arm64, linux-x64, linux-arm64
bun scripts/build.ts --skip-web --version 0.2.0   # reuse web/dist; stamp a version
bun scripts/build.ts --update-url https://updates.example.com/server   # bake an update feed
```

The build:

- compiles the dashboard (`web/`) and embeds `web/dist` in the binary,
- compiles with `bun build --compile`,
- re-signs darwin builds ad hoc. Without that, current macOS kills them on launch.

### What's inside the binary

The binary is self-contained. The dashboard, the database (Postgres, as PGlite) and ffmpeg are all inside, and it sets them up in its data folder on first start.

ffmpeg and ffprobe are [jellyfin-ffmpeg](https://github.com/jellyfin/jellyfin-ffmpeg) (static, with VideoToolbox, VAAPI and QSV). They are:

- pinned by version and SHA-256 in `src/platform/ffmpegInstall.ts`,
- embedded gzipped by `scripts/build.ts`,
- unpacked into `<data-dir>/bin` with their licence notice (they're GPL).

## Releases

`.github/workflows/server-release.yml` publishes GitHub releases. The repository is public, so servers download them without a login.

| Channel | When | Version | Where |
|---|---|---|---|
| Nightly | Every server change merged to `main` | `<next patch>-nightly.<run>` | The rolling `server-nightly` prerelease |
| Stable | `apps/server/package.json` has a version with no `server-v<version>` tag | `<version>` | A `server-v<version>` release with the binaries, and its manifest in the rolling `server-stable` release |

To ship a stable release, bump the version in `apps/server/package.json` and merge.

- Builds use the feed `https://github.com/Sehalsein/strata/releases/download/server-{channel}` (`--update-url … --channel <channel>`), so a server reads `server-<channel>/manifest.json`.
- Manifests are signed in CI with `STRATA_UPDATE_PRIVATE_KEY`, a secret of the `server-release` environment, which only `main` can deploy to. Signing only runs when publishing.
- A manual run (Actions → Server Release) builds without signing or publishing unless *Publish* is ticked.
- `.github/workflows/server-ci.yml` typechecks, tests and build-checks every server change.

### Signing a release by hand

```sh
bun scripts/keygen.ts --private-out ~/strata-update.key --write-public   # once; commits nothing secret
bun scripts/build.ts --all --version 0.2.0 --update-url https://updates.example.com/server
bun scripts/release-manifest.ts --version 0.2.0 --channel stable --dir dist \
  --base-url https://updates.example.com/server --out dist/feed --key-file ~/strata-update.key
```

Then upload `dist/strata-server-<platform>` as `<base>/strata-server-0.2.0-<platform>`, followed by `dist/feed/manifest.json` and `manifest.json.sig`. Upload the binaries first.

About the keys:

- The public key in `src/update/publicKey.ts` is compiled into every binary. Commit it.
- Never commit the private key (base64 PKCS#8 DER from keygen, or a PEM block). Keep an offline backup: without it, existing servers won't accept any update.
- `release-manifest.ts` refuses to sign with a key that doesn't match the embedded public key.

## Network discovery

The server advertises itself on the LAN as `_strata._tcp` (TXT `version`, `api`, `id`). It uses `dns-sd` on macOS and `avahi-publish-service` on Linux (`apt install avahi-utils`). Turn it off under Settings → Network.

`id` is a stable per-install id, kept in `<data-dir>/server-id` and also returned by `GET /api/info`.

## Known limitations

- The TorBox integration has only been checked against the API docs, not a live account.
- HLS uses an EVENT playlist that grows as ffmpeg works. Seeking past what's been produced starts a new play session at that `startMs`, and the client offsets its timeline by `startOffsetMs`. With stream copy, the real start snaps to the previous keyframe (up to about one segment early).
