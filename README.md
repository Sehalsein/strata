# Strata

Strata is a media app for the movies and shows you already have. You run the server at home, next to your files, and watch on iPhone, iPad, Mac and Apple TV, with artwork, resume, Continue Watching, My List and a profile for everyone in the house.

Website: [strata.sehalsein.com](https://strata.sehalsein.com)

## Quick start

**Mac** (Apple silicon, macOS 14 or later): download [Strata.dmg](https://github.com/Sehalsein/strata/releases/download/server-stable/Strata.dmg), drag Strata to Applications and open it. Or use Homebrew:

```sh
brew tap sehalsein/strata https://github.com/Sehalsein/strata
brew trust sehalsein/strata   # Homebrew asks before loading casks from other taps
brew install --cask strata
```

Strata runs from the menu bar, starts at login, sets up ffmpeg and keeps itself up to date. Open `http://localhost:8420` (or **Open Dashboard** in the menu bar) to finish setup.

**Linux:** a single binary that installs itself as a service. See [Install the server](apps/server/README.md#install).

## Try the demo

No server needed. On the app's Connect screen, enter `https://strata-demo.seinsehal.workers.dev` (on Apple TV, choose **Enter Address** first) and sign in as `demo` / `strata-demo`.

- It plays public-domain films and is viewer-only.
- It's tightly rate limited: a few plays per visitor an hour, a few viewers at once.
- It sleeps when idle, so the first request can take a few seconds.

## What's in this repo

| Folder | What it is | Docs |
|---|---|---|
| `apps/server` | The server: Bun and Hono on Postgres, with a web dashboard. Ships as `Strata.app` on macOS. | [README](apps/server/README.md) |
| `apps/server/web` | The web dashboard | [README](apps/server/web/README.md) |
| `apps/apple` | iPhone, iPad and Apple TV apps, in SwiftUI | [README](apps/apple/README.md) |
| `apps/landing` | The website, strata.sehalsein.com | |
| `deploy/cloud` | The server as a stateless Docker image | [README](deploy/cloud/README.md) |
| `deploy/cloudflare` | The cloud server on Cloudflare Workers | [README](deploy/cloudflare/README.md) |
| `deploy/cloudflare-demo` | The public demo | [README](deploy/cloudflare-demo/README.md) |
| `deploy/anilist-relay` | Relay that lets the cloud server reach AniList | [README](deploy/anilist-relay/README.md) |

## What Strata does and doesn't do

Strata doesn't host, provide or index any media. It plays files you already have, and uses [TMDB](https://www.themoviedb.org) for movie and show information with your own API key.

You're responsible for using it in line with the laws where you live and the terms of the services you connect. The project isn't affiliated with or endorsed by any of them.

## Contributions

This is a personal project, published so others can read and run it. Pull requests aren't being accepted, but you're welcome to fork it.

## Attribution

- Movie and show data from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.
- Anime rankings from [Kitsu](https://kitsu.app), anime details from [AniList](https://anilist.co), and anime id mappings from [Fribb/anime-lists](https://github.com/Fribb/anime-lists).
- Anime file names are read with [anitomy-ng](https://github.com/tylergibbs2/anitomy-ng) (MIT, vendored in [apps/server/src/vendor/anitomy](apps/server/src/vendor/anitomy)).

## License

[MIT](LICENSE). Vendored third-party code keeps its own license (see [apps/server/src/vendor/anitomy/LICENSE](apps/server/src/vendor/anitomy/LICENSE)).
