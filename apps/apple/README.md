# Strata for Apple platforms

The SwiftUI client for Strata servers on **iPhone, iPad and Apple TV** (iOS / iPadOS / tvOS 26+). It browses the server's catalog, plays what's in the server's library, and keeps progress per profile. It can be signed in to several Strata servers at once. The design follows the [Strata Design System](https://claude.ai/artifact/QefputW8ZwjL9kcAjqX8tu): a dark-first look, SF Pro, and Liquid Glass for every control that floats over content.

| Package | What it does |
|---|---|
| `Packages/StrataKit` | Server API client (`StrataClient`), models, multi-server `ServerStore` (Keychain tokens, address failover), Bonjour `ServerBrowser` (`_strata._tcp`), device playback capabilities, HLS media-time maths |
| `Packages/StrataDesign` | Tokens (`Theme`, `Metrics`, type scale), artwork and placeholder views, poster/continue cards, rails, hero, glass buttons, badges, availability labels, the Strata mark |
| `Packages/StrataPlayerUI` | `PlayerEngine` (AVPlayer over the server's direct/HLS streams, restart-on-seek outside the produced range, WebVTT subtitles, progress reporting), the glass player chrome, Now Playing / remote commands / PiP / AirPlay bridges |
| `Packages/StrataFeatures` | Screens: connect (Bonjour + manual address), sign-in, profiles, Home, Movies, Shows, Search, My List, movie and show pages, source picker, player |
| `App/` | `@main` app and app delegate |
| `StrataWidgets/` | Lock Screen / Dynamic Island Now Playing Live Activity |

## Run

```sh
brew install xcodegen
cd apps/apple
xcodegen generate
open Strata.xcodeproj
```

Pick the `Strata` scheme and an iPhone, iPad or Apple TV simulator. On first launch the app lists Strata servers on the network; you can also type an address (port 8420 is added automatically).

Debug builds accept `-StrataOpenURL strata://…` as a launch argument to open a link at startup (`strata://movie/<id>`, `strata://show/<id>`, `strata://watch/movie/<id>`, `strata://watch/episode/<show>/<season>/<episode>`).

## Tests

```sh
cd Packages/StrataKit && swift test
# Live tests against a running server (token must have a profile selected):
STRATA_TEST_SERVER=http://127.0.0.1:8420 STRATA_TEST_TOKEN=… swift test           # StrataKit integration
cd ../StrataPlayerUI && STRATA_TEST_SERVER=… STRATA_TEST_TOKEN=… swift test       # PlayerEngine playback
```

CI and TestFlight delivery are described in [TESTFLIGHT.md](TESTFLIGHT.md).
