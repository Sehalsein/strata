# Strata Server

A self-hosted media server. You browse one catalog (from TMDB), and each title plays from
your local folders or your TorBox account. It runs headless and is configured from a web
dashboard in your browser. See [DESIGN.md](DESIGN.md) for the architecture.

## Run

```sh
./strata-server                      # http://localhost:8420; the first visit runs setup
./strata-server --port 9000 --data-dir /srv/strata
./strata-server --version
```

| Option | Env | Default |
|---|---|---|
| `--port` | `STRATA_PORT` | `8420` |
| `--host` | `STRATA_HOST` | `0.0.0.0` |
| `--data-dir` | `STRATA_DATA_DIR` | `~/Library/Application Support/Strata` (macOS), `~/.local/share/strata` (Linux) |
| `--web-dir` | `STRATA_WEB_DIR` | embedded dashboard |
| | `TMDB_API_KEY`, `TORBOX_API_KEY` | override keys saved in the dashboard |
| | `STRATA_DEBUG=1` | debug logging (includes ffmpeg command lines) |

You need ffmpeg and ffprobe for probing and remuxing (`brew install ffmpeg`). The server
looks for them in `$PATH`, `/opt/homebrew/bin`, `/usr/local/bin`, and `<data-dir>/bin`.

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
- Planned for phase 2: Bonjour, self-update, `service install`, scrapers and the TorBox cache
  check, and a downloaded ffmpeg.
