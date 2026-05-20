# Personal sideload deploy

Build and host Strata for your own iPhone, iPad, and Android TV from this Mac.
No App Store, no Play Store, no $99 developer account required.

```
                 ┌──────────────┐
                 │   Your Mac   │
                 │   make all   │
                 └──────┬───────┘
                        │ http (LAN or Tailscale)
            ┌───────────┼────────────┐
            ▼           ▼            ▼
        iPhone        iPad     Android TV
        AltStore     AltStore   Downloader
```

## One-time setup

### On your Mac

```sh
brew install xcodegen        # for iOS build
brew install gradle          # only if apps/tv-android has no gradlew
```

Optional: install [AltServer](https://altstore.io) so AltStore on your iOS
devices can refresh its 7-day signature without plugging into Xcode.

### On each iPhone / iPad

1. Install **AltStore** via AltServer (see altstore.io).
2. Open AltStore → **Browse → Sources → +**.
3. Paste the source URL printed by `make ios` (e.g. `http://192.168.1.5:8080/source.json`).

### On each Android TV

1. From the Play Store, install **Downloader** (free, by AFTVnews).
2. Allow it to install unknown apps when prompted.

## Daily flow

```sh
cd tools/deploy

make ios         # build IPA, refresh AltStore source.json
make android     # build APK, refresh landing page
make all         # both
make serve       # host out/ over HTTP on :8080
```

Devices update themselves:

- **iOS / iPadOS:** AltStore polls the source URL, surfaces "Update Available"
  in the Updates tab. Tap once. Both devices update independently from the same source.
- **Android TV:** open Downloader, recall the URL, tap **Go**. Same URL each time.

## Hosting options

The Makefile picks your LAN IP by default. Override `HOST`/`PORT`/`SCHEME`:

```sh
# Tailscale + Caddy (auto-HTTPS anywhere)
make ios HOST=strata.tail-abc.ts.net PORT=443 SCHEME=https
make serve PORT=8443     # then put Caddy in front of :8443

# Public IP (your call on security)
make ios HOST=home.example.com PORT=443 SCHEME=https
```

The values bake into `source.json` and `index.html`, so devices know where to
fetch from. If you change networks, re-run the build to refresh URLs.

### Caddy + Tailscale (recommended for "works anywhere")

`~/Caddyfile`:

```
strata.tail-abc.ts.net {
  root * /Users/you/sehalsein/hbo/tools/deploy/out
  file_server browse
}
```

```sh
brew install caddy
sudo caddy run --config ~/Caddyfile
```

Caddy auto-fetches a Let's Encrypt cert via Tailscale. The source.json URL
now works from anywhere your devices are signed into Tailscale.

## What's actually in `out/`

After running both builds:

| File | What |
|---|---|
| `source.json` | AltStore source manifest. Subscribe in AltStore once per device. |
| `Strata-<version>-<build>.ipa` | Unsigned IPA. AltStore re-signs with your Apple ID on install. |
| `Strata-latest.ipa` | Symlink-style copy pointing at the newest IPA. |
| `Strata-tv-<version>-<build>.apk` | Debug-signed APK for Android TV. |
| `Strata-tv-latest.apk` | Newest APK alias. |
| `tv` | Symlink to newest APK. Downloader app fetches `BASE_URL/tv`. |
| `index.html` | Human landing page if you visit `BASE_URL` in a browser. |

## Caveats

### iOS / iPadOS

- The build is **unsigned**. AltStore re-signs at install time using whichever
  Apple ID is signed into AltStore on the device. Free Apple ID = 7-day re-sign
  (handled automatically by AltStore as long as your Mac running AltServer is
  reachable on the same network roughly weekly). Paid = 1 year.
- The widget extension (`StrataWidgets`) is **stripped** before zipping the
  IPA, because free Apple IDs can't sign WidgetKit / Live Activity extensions.
  Main app launches fine; no Dynamic Island / Lock Screen activity.
- Free Apple IDs are capped at 3 sideloaded apps at once.

### Android TV

- Debug APK is signed with your machine's `~/.android/debug.keystore`. Stable
  across rebuilds on the same Mac, so updates install in-place. If you switch
  Macs, the cert changes and Android will refuse to update — you'll need to
  uninstall first. Set up a personal release keystore in
  `apps/tv-android/app/build.gradle.kts` to avoid this.
- `Downloader` is the smoothest installer for Android TV — its on-screen
  keyboard makes typing the URL bearable. The first install needs you to
  approve unknown sources in the system settings; it walks you through it.

### "Make this even smoother"

- Add `network_security_config` for cleartext HTTP if your `BASE_URL` is
  plain `http://` and your Jellyfin server is on the same LAN — Android 9+
  blocks cleartext by default for `app` traffic, but installing from a
  cleartext URL via Downloader still works (it's a separate code path).
- If you want versioned releases pinned on the TV, swap `:app:assembleDebug`
  → `:app:assembleRelease` in `build-apk.sh` and add a proper signing config.
