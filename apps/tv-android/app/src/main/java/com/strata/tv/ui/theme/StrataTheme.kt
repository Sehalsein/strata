package com.strata.tv.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ColorScheme
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Typography
import androidx.tv.material3.darkColorScheme

/**
 * Strata TV theme — Material3 (TV) color scheme + Typography. Type scale
 * is bumped ~1.4× from the web for 10-ft legibility. The three editorial
 * families (Fraunces / IBM Plex Sans / JetBrains Mono) come from
 * `StrataType` — see `ui/theme/Type.kt` and `app/FONTS.md` for drop-in
 * instructions.
 */
private val display = StrataType.Fraunces
private val body = StrataType.Plex
private val mono = StrataType.Mono

private val strataTypography = Typography(
    displayLarge = TextStyle(fontFamily = display, fontWeight = FontWeight.Medium, fontSize = 80.sp),
    displayMedium = TextStyle(fontFamily = display, fontWeight = FontWeight.Medium, fontSize = 56.sp),
    displaySmall = TextStyle(fontFamily = display, fontWeight = FontWeight.Medium, fontSize = 42.sp),
    headlineLarge = TextStyle(fontFamily = display, fontWeight = FontWeight.Medium, fontSize = 36.sp),
    headlineMedium = TextStyle(fontFamily = display, fontWeight = FontWeight.Medium, fontSize = 28.sp),
    headlineSmall = TextStyle(fontFamily = display, fontWeight = FontWeight.Medium, fontSize = 22.sp),
    titleLarge = TextStyle(fontFamily = body, fontWeight = FontWeight.SemiBold, fontSize = 24.sp),
    titleMedium = TextStyle(fontFamily = body, fontWeight = FontWeight.Medium, fontSize = 20.sp),
    titleSmall = TextStyle(fontFamily = body, fontWeight = FontWeight.Medium, fontSize = 18.sp),
    bodyLarge = TextStyle(fontFamily = body, fontSize = 22.sp),
    bodyMedium = TextStyle(fontFamily = body, fontSize = 18.sp),
    bodySmall = TextStyle(fontFamily = body, fontSize = 16.sp),
    labelLarge = TextStyle(fontFamily = body, fontWeight = FontWeight.Medium, fontSize = 18.sp),
    labelMedium = TextStyle(fontFamily = body, fontWeight = FontWeight.Medium, fontSize = 16.sp),
    labelSmall = TextStyle(fontFamily = body, fontWeight = FontWeight.Medium, fontSize = 14.sp),
)

private val strataColors: ColorScheme = darkColorScheme(
    primary = StrataColors.Accent,
    onPrimary = StrataColors.Paper,
    primaryContainer = StrataColors.Accent2,
    onPrimaryContainer = StrataColors.Ink,
    secondary = StrataColors.Accent2,
    onSecondary = StrataColors.Ink,
    background = StrataColors.Bg,
    onBackground = StrataColors.Paper,
    surface = StrataColors.Bg2,
    onSurface = StrataColors.Paper,
    surfaceVariant = StrataColors.Ink,
    onSurfaceVariant = StrataColors.Paper.copy(alpha = 0.62f),
    border = StrataColors.PanelBorder,
    borderVariant = StrataColors.PanelBorder,
)

/**
 * Ambient palette propagation. Screens push the palette for their
 * focused/current item; backgrounds + focus indications read from
 * here. Matches the web's `ThemeAmbientContext`.
 */
val LocalStrataPalette = compositionLocalOf { StrataPalettes.first() }
val LocalStrataFonts = staticCompositionLocalOf {
    StrataFonts(display = display, body = body, mono = mono)
}

data class StrataFonts(
    val display: FontFamily,
    val body: FontFamily,
    val mono: FontFamily,
)

@Composable
fun StrataTheme(
    palette: StrataPalette = StrataPalettes.first(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalStrataPalette provides palette) {
        MaterialTheme(
            colorScheme = strataColors,
            typography = strataTypography,
            content = content,
        )
    }
}
