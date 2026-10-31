# Strata

**Your media, beautifully.** Strata is a media app for the movies and shows you already
have. It turns your own library into a home screen worth sitting down to, on iPhone, iPad,
Mac and Apple TV: artwork and details for every title, resume anywhere, Continue Watching,
My List, and a profile for everyone in the house.

Two ways to run it, with the same apps:

- **Strata Cloud** at [strata.sehalsein.com](https://strata.sehalsein.com): sign up, bring
  your media, and press play. Nothing to install.
- **Self-hosted:** run the server on your own Mac or Linux machine, next to the folders of
  files on your disk (see [Install the server](#install-the-server)).

The code:

- **Server** ([apps/server](apps/server)): Bun and Hono, on Postgres, with a web dashboard.
  On macOS it ships as `Strata.app`, a menu bar app you install like any other. The same
  code runs Strata Cloud on Cloudflare Workers.
- **Apple apps** ([apps/apple](apps/apple)): iPhone, iPad and Apple TV, in SwiftUI.
- **Landing site** ([apps/landing](apps/landing)): strata.sehalsein.com.

## Install the server

**Mac** (Apple silicon, macOS 14 or later): download
[Strata.dmg](https://github.com/Sehalsein/strata/releases/download/server-stable/Strata.dmg),
drag Strata to Applications and open it. Or with Homebrew:

```sh
brew tap sehalsein/strata https://github.com/Sehalsein/strata
brew trust sehalsein/strata   # Homebrew asks before loading casks from other taps
brew install --cask strata
```

Strata runs from the menu bar, starts at login, sets up ffmpeg on its own and keeps itself
up to date. Open `http://localhost:8420` (or choose **Open Dashboard** from the menu bar) to
finish setup.

**Linux:** a single binary that installs itself as a service; see
[apps/server/README.md](apps/server/README.md#install).

To build the apps yourself, see [apps/apple/README.md](apps/apple/README.md).

**Try it without a server:** enter `https://strata-demo.seinsehal.workers.dev` in the app
and sign in as `demo` / `strata-demo` (see [Try it](#try-it)).

## Contributions

This is a personal project, published so others can read and run it. Pull requests aren't
being accepted. You're welcome to fork it.

## What Strata does and doesn't do

Strata doesn't host, provide or index any media. It plays files you already have, and
uses [TMDB](https://www.themoviedb.org) for movie and show information with your own API
key.

You're responsible for using it in line with the laws where you live and the terms of the
services you connect. The project isn't affiliated with or endorsed by any of them.

## Try it

A public demo server with public-domain films is at
**https://strata-demo.seinsehal.workers.dev**. Type that address on the app's Connect
screen (on Apple TV, choose **Enter Address** first) and sign in as `demo` /
`strata-demo`. It's viewer-only and tightly rate limited (a few plays per visitor an hour,
a few viewers at once), and it sleeps when idle, so the first request can take a few
seconds.

## Attribution

Movie and show data from [TMDB](https://www.themoviedb.org). This product uses the TMDB API
but is not endorsed or certified by TMDB.

Anime rankings from [Kitsu](https://kitsu.app), anime details from
[AniList](https://anilist.co), and anime id mappings from
[Fribb/anime-lists](https://github.com/Fribb/anime-lists). Anime file names are read with
[anitomy-ng](https://github.com/tylergibbs2/anitomy-ng) (MIT, vendored in
[apps/server/src/vendor/anitomy](apps/server/src/vendor/anitomy)).

## License

[MIT](LICENSE). Vendored third-party code keeps its own license (see
[apps/server/src/vendor/anitomy/LICENSE](apps/server/src/vendor/anitomy/LICENSE)).
