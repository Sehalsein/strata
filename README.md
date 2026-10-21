# Strata

A self-hosted media server with native Apple apps. You browse one catalog of movies,
shows and anime, and play what's in your own library on iPhone, iPad and Apple TV.

- **Server** ([apps/server](apps/server)): Bun, Hono and SQLite, with a web dashboard. On
  macOS it ships as `Strata.app`, a menu bar app you install like any other.
- **Apple apps** ([apps/apple](apps/apple)): iPhone, iPad and Apple TV, in SwiftUI.

See [apps/server/README.md](apps/server/README.md) to run the server and
[apps/apple/README.md](apps/apple/README.md) to build the apps.

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
**https://strata-demo.seinsehal.workers.dev**: add it in the app and sign in as
`demo` / `strata-demo`.

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
