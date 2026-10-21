# Strata

A self-hosted media server with native Apple apps. You browse one catalog of movies,
shows and anime, and each title plays from your own folders or from your own TorBox
account.

- **Server** ([apps/server](apps/server)): Bun, Hono and SQLite, with a web dashboard. On
  macOS it ships as `Strata.app`, a menu bar app you install like any other.
- **Apple apps** ([apps/apple](apps/apple)): iPhone, iPad and Apple TV, in SwiftUI.

See [apps/server/README.md](apps/server/README.md) to run the server and
[apps/apple/README.md](apps/apple/README.md) to build the apps.

## Contributions

This is a personal project, published so others can read and run it. Pull requests aren't
being accepted. You're welcome to fork it.

## What Strata does and doesn't do

Strata doesn't host, provide or index any media. It plays files you already have and
connects to services you sign up for yourself, with your own keys:

- [TMDB](https://www.themoviedb.org) for movie and show information.
- [TorBox](https://torbox.app), a debrid service, if you add your own API key.
- Public release indexes such as Torrentio, to find releases for your TorBox account.

You're responsible for using it in line with the laws where you live and the terms of the
services you connect. The project isn't affiliated with or endorsed by any of them, and
their names are used only to describe what Strata connects to.

## Attribution

Movie and show data from [TMDB](https://www.themoviedb.org). This product uses the TMDB API
but is not endorsed or certified by TMDB.

Anime rankings from [Kitsu](https://kitsu.app), anime details from
[AniList](https://anilist.co), and anime id mappings from
[Fribb/anime-lists](https://github.com/Fribb/anime-lists). Anime file names are read with
[anitomy-ng](https://github.com/tylergibbs2/anitomy-ng) (MIT, vendored in
[apps/server/src/vendor/anitomy](apps/server/src/vendor/anitomy)).

## License

No license has been chosen yet, so all rights are reserved for now.
