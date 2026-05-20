# Fonts

Drop the following font files here before building if you want the editorial
type identity. They are intentionally **not** committed (mirrors the Apple
side at `apps/apple/Resources/Fonts/README.md`).

Required files:

- `fraunces.ttf` — variable font, from
  https://fonts.google.com/specimen/Fraunces (download → "Static & Variable"
  → grab the variable `.ttf`).
- `ibm_plex_sans_regular.ttf`, `ibm_plex_sans_medium.ttf`,
  `ibm_plex_sans_semibold.ttf`, `ibm_plex_sans_bold.ttf` —
  https://fonts.google.com/specimen/IBM+Plex+Sans.
- `jetbrains_mono_regular.ttf`, `jetbrains_mono_medium.ttf`,
  `jetbrains_mono_semibold.ttf` —
  https://fonts.google.com/specimen/JetBrains+Mono.

After dropping them in, edit `ui/theme/Type.kt`: replace the three
`FontFamily.Serif/SansSerif/Monospace` constants in `StrataType` with
`FontFamily(Font(R.font.fraunces), …)` etc., and the rest of the codebase
picks up the editorial type automatically.

If you build without dropping the fonts in, every call falls back to the
platform's `Serif` / `SansSerif` / `Monospace` family (same silent-fallback
behaviour as Apple's `Font(name:size:)` helpers when the Postscript name
isn't registered).
