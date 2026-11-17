# Strata for Apple platforms

The SwiftUI app for Strata servers on iPhone, iPad and Apple TV (iOS, iPadOS and tvOS 26 or later). This file is for building and testing it yourself.

## Quick start

```sh
brew install xcodegen
cd apps/apple
xcodegen generate
open Strata.xcodeproj
```

Pick the `Strata` scheme and an iPhone, iPad or Apple TV simulator (Apple silicon). Playback runs on [AetherEngine](https://github.com/superuser404notfound/AetherEngine), which Swift Package Manager fetches with its FFmpeg build; it needs Xcode 27.

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
| `Packages/StrataPlayerUI` | `PlayerEngine` (plays the server's sessions on [AetherEngine](https://github.com/superuser404notfound/AetherEngine): TorBox links, downloads and the server's own streams; copy fallback, fresh links, restart-on-seek for server HLS, subtitles, progress and play reports), `MediaProbe` (a file's media info for the server), the glass player chrome, Now Playing, remote commands, PiP and AirPlay |
| `Packages/StrataFeatures` | Screens: connect, sign-in (password, home-network join, TV code), Who's watching, households, Home, Movies, Shows, Search, My List, movie and show pages, source picker, player |
| `App/` | The `@main` app and app delegate |
| `StrataWidgets/` | Lock Screen and Dynamic Island Now Playing Live Activity |
| `StrataTopShelf/` | The Apple TV's Top Shelf: Continue Watching and Up Next from the snapshot the app keeps in the App Group (`TopShelf` in StrataKit); Play starts only an item on it |

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
- `strata://reset-password?server=<address>&token=<token>` (the token is in a reset email's link; with `STRATA_EMAIL_LOG=1` the server logs the email)

## CI and TestFlight

See [TESTFLIGHT.md](TESTFLIGHT.md).
