# Strata TV (Android TV)

Jetpack Compose for TV client for the same Jellyfin server the web app at `apps/web` talks to. Mirror of the 8 web screens, same auth + progress reporting, Media3 ExoPlayer instead of HLS.js, Quick Connect primary login.

## First-run setup

This project is **not** wired into the Bun/Turbo monorepo. Open it as its own Android Studio project (`File → Open` → `apps/tv-android`).

### Generate the Gradle wrapper

The wrapper jar isn't committed. From the project root:

```bash
cd apps/tv-android
gradle wrapper --gradle-version 8.10
```

(Requires a system-installed `gradle`; `brew install gradle`. Android Studio will offer to do this for you if you import the project without the wrapper.)

### Point at your Jellyfin server

The default is `http://10.0.2.2:8096` — the host loopback as seen from the Android TV emulator, matching `docker compose up` from the monorepo root. Override per-machine in `~/.gradle/gradle.properties`:

```
strata.jellyfinUrl=http://192.168.1.50:8096
```

## Build & run

```bash
./gradlew :app:assembleDebug
./gradlew :app:installDebug

# Launch on the running emulator/device
adb shell am start -n com.strata.tv/.MainActivity
```

In Android Studio's Device Manager, create an **Android TV (1080p)** device on API 34+.

## Layout

```
app/src/main/
├── AndroidManifest.xml          # leanback launcher, banner, StrataApp
├── res/                         # themes, colors, banner, launcher icon
└── java/com/strata/tv/
    ├── StrataApp.kt             # Application + Coil image loader setup
    ├── MainActivity.kt          # hosts StrataNavHost
    ├── di/ServiceLocator.kt     # singletons: AuthStore, ApiClient, Repository
    ├── data/                    # port of apps/web/src/lib/api.ts
    │   ├── ApiClient.kt
    │   ├── AuthStore.kt         # EncryptedSharedPreferences + device id
    │   ├── Repository.kt        # list/get/search + Quick Connect + password auth
    │   ├── StreamPlan.kt        # buildStreamPlan (ExoPlayer-safe codec set)
    │   ├── Progress.kt          # reportPlaybackStart/Progress/Stopped
    │   └── ImageUrls.kt
    └── ui/
        ├── nav/StrataNavHost.kt # 8 routes
        ├── shell/AppShell.kt    # top nav + ambient backdrop
        ├── screens/             # Home, Login (QuickConnect + password), Movies,
        │                        # Shows, MovieDetail, ShowDetail, Search, watch/
        ├── components/          # PosterCard, PosterGrid, PosterRow, Loaders
        └── theme/               # Palettes (18), PaletteFromId, TitleAmbience,
                                 # Motifs (18), StrataTheme
```

## Parity with apps/web

| Web | TV |
|---|---|
| `lib/api.ts` | `data/Repository.kt` + `StreamPlan.kt` + `Progress.kt` + `ImageUrls.kt` |
| `lib/auth-client.ts` | `data/AuthStore.kt` (StateFlow<Session?>) |
| `strata/theme.ts` palettes + `hashStr` | `ui/theme/Palettes.kt` + `PaletteFromId.kt` |
| `strata/Poster.tsx` motifs | `ui/theme/Motifs.kt` (simplified Canvas) |
| `strata/theme.ts:titleAmbience` | `ui/theme/TitleAmbience.kt` |
| `router.tsx` | `ui/nav/StrataNavHost.kt` |
| `components/AppShell.tsx` | `ui/shell/AppShell.kt` |
| `routes/home.tsx` | `ui/screens/HomeScreen.kt` |
| `routes/login.tsx` (password only) | `ui/screens/LoginScreen.kt` (**Quick Connect primary** + password fallback) |
| `routes/{movies,shows}.tsx` | `ui/screens/MoviesScreen.kt` (also `ShowsScreen`) |
| `routes/{movie,show}-detail.tsx` | `ui/screens/{MovieDetail,ShowDetail}Screen.kt` |
| `routes/search.tsx` | `ui/screens/SearchScreen.kt` |
| `routes/watch.tsx` + `components/player/Player.tsx` | `ui/screens/watch/WatchScreen.kt` (Media3 `PlayerView`) |

The same Jellyfin item id resolves to the **same palette and motif** on web and TV because `PaletteFromId.kt:hashStr` is a verbatim port of `strata/theme.ts:hashStr`.

## Known follow-ups

These were scoped out of the initial cut; pick up as needed:

- `res/font/` — ship Fraunces / IBM Plex Sans / JetBrains Mono and wire into `StrataTheme.kt` (placeholders are `Serif` / `SansSerif` / `Monospace`).
- `ChaptersRail` + `UpNextOverlay` Compose overlays (plan §Video player).
- `exo_player_control_view.xml` Strata-skinned override (currently using Media3 default chrome).
- Real PNG banner (currently a vector `drawable/app_banner.xml` placeholder).
- Trickplay scrubber thumbnails on the scrubber (Jellyfin's `Trickplay` images).
- Jellyfin SDK call signatures may need adjustment to match the bundled `org.jellyfin.sdk:jellyfin-core` version (e.g. `authenticateUserByName` sometimes takes a `data: AuthenticateUserByName` DTO instead of bare args). Fix at the call site in `Repository.kt` after the first build.
