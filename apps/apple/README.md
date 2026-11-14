# Strata for Apple platforms

The SwiftUI app for Strata servers on iPhone, iPad and Apple TV (iOS, iPadOS and tvOS 26 or later). This file is for building and testing it yourself.

## Quick start

```sh
brew install xcodegen
cd apps/apple
Packages/StrataRemux/scripts/build-ffmpeg.sh   # once: FFmpeg isn't kept in git
xcodegen generate
open Strata.xcodeproj
```

Pick the `Strata` scheme and an iPhone, iPad or Apple TV simulator. FFmpeg is built for Apple silicon simulators only.

On first launch the app lists Strata servers on your network. You can also type an address; port 8420 is added for you.

## What the app does

- Browses the server's catalog, plays what the server offers, and keeps progress per account.
- Shows a title's sources (and lets you pick one) only when the server lists some, using the server's own labels.
- Keeps several sign-ins, on one server or several, and switches between them from "Who's watching?".
- Follows the [Strata Design System](https://claude.ai/artifact/QefputW8ZwjL9kcAjqX8tu): dark first, SF Pro, and Liquid Glass for every control that floats over content.

## Code layout

| Folder | What's in it |
|---|---|
| `Packages/StrataKit` | Server API client (`StrataClient`), models, multi-server `ServerStore` (Keychain tokens, address failover), Bonjour `ServerBrowser` (`_strata._tcp`), device playback capabilities, HLS media-time maths |
| `Packages/StrataDesign` | Tokens (`Theme`, `Metrics`, type scale), artwork and placeholders, poster and continue cards, rails, hero, glass buttons, badges, availability labels, the Strata mark |
| `Packages/StrataPlayerUI` | `PlayerEngine` (AVPlayer over the server's direct and HLS streams, restart-on-seek, WebVTT subtitles, progress reporting), the glass player chrome, Now Playing, remote commands, PiP and AirPlay |
| `Packages/StrataRemux` | Repackages files on the device into HLS for the player, using FFmpeg (LGPL, built by `scripts/build-ffmpeg.sh`) |
| `Packages/StrataFeatures` | Screens: connect, sign-in (password, home-network join, TV code), Who's watching, households, Home, Movies, Shows, Search, My List, movie and show pages, source picker, player |
| `App/` | The `@main` app and app delegate |
| `StrataWidgets/` | Lock Screen and Dynamic Island Now Playing Live Activity |

## Tests

```sh
cd Packages/StrataKit && swift test
```

Live tests run against a real server. StrataKit sets the server up on first run, and the token must belong to a household.

```sh
# StrataKit integration
STRATA_TEST_SERVER=http://127.0.0.1:8420 STRATA_TEST_TOKEN=… swift test
# PlayerEngine playback
cd ../StrataPlayerUI && STRATA_TEST_SERVER=… STRATA_TEST_TOKEN=… swift test
```

## Opening a link at launch

Debug builds accept `-StrataOpenURL strata://…` as a launch argument:

- `strata://movie/<id>`
- `strata://show/<id>`
- `strata://watch/movie/<id>`
- `strata://watch/episode/<show>/<season>/<episode>`

## CI and TestFlight

See [TESTFLIGHT.md](TESTFLIGHT.md).
