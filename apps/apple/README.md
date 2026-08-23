# Strata for Apple platforms

Native SwiftUI client for the Strata Jellyfin server, targeting **iOS 17 / iPadOS 17 / macOS 14**. Shares no code with `apps/web` or `apps/tv-android` but mirrors the same Jellyfin API surface and the **Cinemathèque** design language pixel-for-pixel where possible (same hex tokens, same hashed palette/motif assignment per title, same procedural editorial motifs).

## What's in here

| Package / target | What it does |
|---|---|
| `Packages/StrataKit` | Networking (`JellyfinClient`, URLSession + async), DTOs (`BaseItem`, `MediaSource`, `MediaStream`, `Chapter`, `Trickplay…`), Keychain-backed `AuthStore`, `StreamPlanner` (1:1 port of `apps/web/src/lib/api.ts:buildStreamPlan`), `PlaybackReporter`, `ImageURLBuilder` (+ trickplay sheet URLs) |
| `Packages/StrataDesign` | Color tokens, Fraunces variable-axis `Font.fraunces(...)`, IBM Plex + JetBrains Mono helpers, **all 18 procedural motif `Shape`s** with palette/motif hashing parity tests vs. the JS source, `Poster`, `Chip`, `OpusBadge`, `Buttons`, `GlassPanel`, `NoiseOverlay`, `Shimmer`, `AmbientBackdrop` |
| `Packages/StrataPlayerUI` | `PlayerEngine` (@Observable wrapping `AVPlayer`), `AVPlayerContainer` (UI/NSView rep over `AVPlayerLayer`), Cinemathèque chrome (`TransportBar`, `Scrubber` with chapter ticks + trickplay preview, `ChaptersRail`, `TrickplayThumbnail`, `AudioMenu`/`SubtitleMenu`/`SpeedMenu`, `StreamDetailsPanel`, `UpNextCard`), `WebVTT` parser + `SubtitleOverlay`, keyboard shortcuts + Mac `PlaybackCommands`, bridges for AirPlay, PiP, Now Playing, Remote Commands, Dynamic Island Live Activities |
| `Packages/StrataFeatures` | Screens (`LoginView`, `HomeView`, `MoviesView`, `ShowsView`, `MovieDetailView`, `ShowDetailView`, `UnifiedDetailView`, `SearchView`, `WatchView`), navigation shells (`PhoneShell` tabs for iPhone/iPad, `MacShell` split view), `MenuBarScene` (Mac), `AppCoordinator` for deep links / Spotlight / Handoff, Spotlight indexer, Handoff `userActivity` modifiers |
| `App/` | `@main StrataApp`, `AppDelegate`, `Info.plist`, entitlements |
| `StrataWidgets/` | Live Activity widget extension target — Lock Screen + Dynamic Island Now Playing surface |

## First-time setup

```sh
brew install xcodegen
cd apps/apple
# 1. drop font files into Resources/Fonts/ — see Resources/Fonts/README.md
# 2. generate the Xcode project
xcodegen generate
# 3. open and run
open Strata.xcworkspace
```

Pick the `Strata` scheme, choose an iPhone / iPad simulator or "My Mac", press ⌘R.

Set your Jellyfin server URL in the in-app login screen on first launch.

## Verifying packages without Xcode

```sh
cd apps/apple/Packages/StrataKit && swift build
cd apps/apple/Packages/StrataDesign && swift test   # requires Xcode license accepted
```

If `swift test` fails with "Xcode license not accepted", run `sudo xcodebuild -license` once.

## Signing

Set `DEVELOPMENT_TEAM` in `project.yml` (or via an `.xcconfig`) before building to a physical device. The registered bundle ID is `com.sehalsein.strata` (widget: `com.sehalsein.strata.widgets`).

GitHub Actions CI and TestFlight delivery for iOS/iPadOS and tvOS are documented in [TESTFLIGHT.md](TESTFLIGHT.md). Release builds use App Store distribution profiles with fixed names; local Debug signing remains unchanged.

## Feature matrix

| Feature | iOS | iPadOS | macOS |
|---|---|---|---|
| Cinemathèque design + 18 motifs | ✓ | ✓ | ✓ |
| Direct play (MP4/MOV) | ✓ | ✓ | ✓ |
| HLS transcoded play | ✓ | ✓ | ✓ |
| Resume from server-side position | ✓ | ✓ | ✓ |
| Progress reporting (start/progress/stopped) | ✓ | ✓ | ✓ |
| Chapter rail + scrubber chapter ticks | ✓ | ✓ | ✓ |
| Trickplay thumbnail preview (when server provides manifest) | ✓ | ✓ | ✓ |
| Audio / subtitle / speed menus | ✓ | ✓ | ✓ |
| Custom WebVTT subtitle rendering | ✓ | ✓ | ✓ |
| AirPlay route picker | ✓ | ✓ | ✓ |
| Picture-in-Picture | ✓ | ✓ | ✓ |
| Stream details panel | ✓ | ✓ | ✓ |
| Up Next auto-advance (series) | ✓ | ✓ | ✓ |
| Now Playing Info + lock-screen scrubber | ✓ | ✓ | ✓ |
| Remote command center (headphones, CarPlay) | ✓ | ✓ | – |
| Keyboard shortcuts (Space, J/L, ←/→, M, F, C, S, P) | – | ✓ | ✓ |
| Mac CommandMenu surfaced in menu bar | – | – | ✓ |
| `MenuBarExtra` quick Continue Watching | – | – | ✓ |
| Spotlight indexing (`CSSearchableItem`) | ✓ | ✓ | ✓ |
| Handoff between devices (`NSUserActivity`) | ✓ | ✓ | ✓ |
| Deep linking (`strata://item/<id>`, `strata://watch/<id>?t=<sec>`) | ✓ | ✓ | ✓ |
| Dynamic Island + Lock Screen Live Activity | ✓ | – | – |

## Known limitations / phase-4 candidates

- Offline downloads are not implemented.
- The Mac AirPlay receiver list relies on `AVRoutePickerView`'s default UI; a custom popover would require a private API or a custom `MPRemoteCommandCenter` glue.
- Live Activity widget code is in `StrataWidgets/` and references its own copy of the activity attributes — change both sides in lockstep.
- Tests require the Xcode license to be accepted (`sudo xcodebuild -license`).
