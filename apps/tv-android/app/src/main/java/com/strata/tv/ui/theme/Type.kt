package com.strata.tv.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * Strata editorial type system. Mirrors Apple's `StrataDesign.Typography`:
 * three families with semantic helpers (`fraunces`, `plex`, `mono`) so call
 * sites describe intent instead of poking `FontFamily` directly.
 *
 * Real fonts: drop these into `app/src/main/res/font/` and swap the three
 * `FontFamily` constants below — every call site picks them up automatically.
 *  - `fraunces.ttf`            — variable, https://fonts.google.com/specimen/Fraunces
 *  - `ibm_plex_sans_*.ttf`     — https://fonts.google.com/specimen/IBM+Plex+Sans
 *  - `jetbrains_mono_*.ttf`    — https://fonts.google.com/specimen/JetBrains+Mono
 *
 * Without the TTFs the app silently falls back to the platform's `Serif` /
 * `SansSerif` / `Monospace` families (same behaviour as Apple's font helpers,
 * which silently fall back when `Font(name:)` can't resolve the Postscript name).
 */
object StrataType {
    val Fraunces: FontFamily = FontFamily.Serif
    val Plex: FontFamily = FontFamily.SansSerif
    val Mono: FontFamily = FontFamily.Monospace
}

/**
 * Fraunces — editorial serif for headlines, titles, italic taglines.
 * `opticalSize` mirrors Fraunces's variable `opsz` axis (8…144); we surface
 * it for documentation even though `FontFamily.Serif` ignores it. When the
 * real variable TTF is dropped in, swap to
 * `Font(R.font.fraunces, weight = weight, variationSettings = FontVariation.Settings(opsz(opticalSize.toFloat())))`.
 */
@Composable
@ReadOnlyComposable
fun fraunces(
    size: TextUnit,
    weight: FontWeight = FontWeight.Medium,
    italic: Boolean = false,
    @Suppress("UNUSED_PARAMETER") opticalSize: Int = 36,
    letterSpacing: TextUnit = 0.sp,
    lineHeight: TextUnit = TextUnit.Unspecified,
): TextStyle = TextStyle(
    fontFamily = StrataType.Fraunces,
    fontWeight = weight,
    fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
    fontSize = size,
    letterSpacing = letterSpacing,
    lineHeight = lineHeight,
)

/** IBM Plex Sans — body / labels / sans UI. */
@Composable
@ReadOnlyComposable
fun plex(
    size: TextUnit,
    weight: FontWeight = FontWeight.Normal,
    italic: Boolean = false,
    letterSpacing: TextUnit = 0.sp,
    lineHeight: TextUnit = TextUnit.Unspecified,
): TextStyle = TextStyle(
    fontFamily = StrataType.Plex,
    fontWeight = weight,
    fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
    fontSize = size,
    letterSpacing = letterSpacing,
    lineHeight = lineHeight,
)

/** JetBrains Mono — spec strips, metadata chips, technical labels. */
@Composable
@ReadOnlyComposable
fun mono(
    size: TextUnit,
    weight: FontWeight = FontWeight.Medium,
    tracking: TextUnit = 2.sp,
): TextStyle = TextStyle(
    fontFamily = StrataType.Mono,
    fontWeight = weight,
    fontSize = size,
    letterSpacing = tracking,
)

/**
 * TV-first named text styles. Screens reference intent (`StrataText.Meta`)
 * instead of hardcoding sizes/families. Colour is set by the call site.
 *
 * Rules of this scale: Fraunces only on big titles/taglines; IBM Plex Sans for
 * all metadata/labels/buttons/chips; JetBrains Mono only on player time-codes.
 * Nothing below 14sp (TV legibility), and metadata is sentence-case (no
 * uppercase, no heavy tracking) — that's what kills the "spec sheet" feel.
 */
object StrataText {
    val HeroTitle = TextStyle(
        fontFamily = StrataType.Fraunces, fontWeight = FontWeight.Medium,
        fontSize = 64.sp, lineHeight = 62.sp, letterSpacing = (-2).sp,
    )
    val DetailTitle = TextStyle(
        fontFamily = StrataType.Fraunces, fontWeight = FontWeight.Medium,
        fontSize = 54.sp, lineHeight = 54.sp, letterSpacing = (-1.6).sp,
    )
    val ScreenTitle = TextStyle(
        fontFamily = StrataType.Fraunces, fontWeight = FontWeight.Medium,
        fontSize = 30.sp, letterSpacing = (-0.6).sp,
    )
    val SectionTitle = TextStyle(
        fontFamily = StrataType.Fraunces, fontWeight = FontWeight.Medium,
        fontSize = 22.sp, letterSpacing = (-0.3).sp,
    )
    val Wordmark = TextStyle(
        fontFamily = StrataType.Fraunces, fontWeight = FontWeight.Medium,
        fontSize = 20.sp, letterSpacing = (-0.4).sp,
    )
    val Tagline = TextStyle(
        fontFamily = StrataType.Fraunces, fontWeight = FontWeight.Medium,
        fontStyle = FontStyle.Italic, fontSize = 18.sp,
    )
    val Overview = TextStyle(
        fontFamily = StrataType.Plex, fontWeight = FontWeight.Normal,
        fontSize = 15.sp, lineHeight = 22.sp,
    )
    val Meta = TextStyle(
        fontFamily = StrataType.Plex, fontWeight = FontWeight.Medium, fontSize = 14.sp,
    )
    val MetaDim = TextStyle(
        fontFamily = StrataType.Plex, fontWeight = FontWeight.Normal, fontSize = 13.sp,
    )
    val Button = TextStyle(
        fontFamily = StrataType.Plex, fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp, letterSpacing = 0.3.sp,
    )
    val TabLabel = TextStyle(
        fontFamily = StrataType.Plex, fontWeight = FontWeight.Medium, fontSize = 14.sp,
    )
    val Chip = TextStyle(
        fontFamily = StrataType.Plex, fontWeight = FontWeight.Medium, fontSize = 13.sp,
    )
    val CardTitle = TextStyle(
        fontFamily = StrataType.Plex, fontWeight = FontWeight.Medium, fontSize = 14.sp,
    )
    val CardSub = TextStyle(
        fontFamily = StrataType.Plex, fontWeight = FontWeight.Normal, fontSize = 12.sp,
    )
    val TimeCode = TextStyle(
        fontFamily = StrataType.Mono, fontWeight = FontWeight.Medium,
        fontSize = 13.sp, letterSpacing = 0.8.sp,
    )
}
