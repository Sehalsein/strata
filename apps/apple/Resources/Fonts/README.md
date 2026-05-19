# Fonts

Drop the following font files here before building. They are intentionally **not** committed.

Required files:

- `Fraunces[opsz,wght,SOFT,WONK].ttf` — variable font, from https://fonts.google.com/specimen/Fraunces (download → "Static & Variable" → grab the variable `.ttf`).
- `IBMPlexSans-Regular.ttf`, `IBMPlexSans-Medium.ttf`, `IBMPlexSans-SemiBold.ttf`, `IBMPlexSans-Bold.ttf` — https://fonts.google.com/specimen/IBM+Plex+Sans.
- `JetBrainsMono-Regular.ttf`, `JetBrainsMono-Medium.ttf`, `JetBrainsMono-SemiBold.ttf` — https://fonts.google.com/specimen/JetBrains+Mono.

The fonts are registered in `Info.plist` under `UIAppFonts` / `ATSApplicationFontsPath`. `StrataDesign/Typography.swift` exposes them as `Font.fraunces(_:)`, `Font.plex(_:)`, `Font.mono(_:)`.

If you build without dropping the fonts in, `Font(name:size:)` will silently fall back to the system default — the app still runs but the editorial type identity is lost.
