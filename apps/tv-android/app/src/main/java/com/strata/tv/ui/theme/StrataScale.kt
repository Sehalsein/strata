package com.strata.tv.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isUnspecified

/**
 * Responsive scale system for the 10-foot UI.
 *
 * Android TV reports a *logical* width in dp that depends on the device, not
 * just the panel: a standard 1080p/4K TV is ~960dp, small boxes can be ~720dp,
 * and wide/monitor-style displays can be 1280dp+. Two levers keep the UI
 * looking right across all of them:
 *
 *  1. **Adaptive grids** — `PosterGrid` sizes columns to a target poster width,
 *     so a wider screen shows *more* posters (not bigger ones) and a narrow one
 *     shows fewer. Content density follows the screen.
 *  2. **Chrome scale** — heroes, the top bar, and the big display type scale by
 *     [factor], a clamped ratio of the screen width to a 960dp baseline, so the
 *     billboard/title feel proportional on a small box and a big wall alike.
 *
 * Body text and metadata are intentionally NOT scaled below their tuned sizes —
 * legibility at 10 feet matters more than strict proportionality.
 */
object StrataScale {
    const val BASELINE_WIDTH_DP = 960f

    /** Screen-width ratio vs the 960dp baseline, clamped to a sane TV range. */
    @Composable
    @ReadOnlyComposable
    fun factor(): Float =
        (LocalConfiguration.current.screenWidthDp / BASELINE_WIDTH_DP).coerceIn(0.85f, 1.3f)

    /** A baseline dp value scaled by the screen [factor]. */
    @Composable
    @ReadOnlyComposable
    fun dp(value: Int): Dp = (value * factor()).dp

    /** Scale a display [TextStyle]'s font + line height by the screen [factor]. */
    @Composable
    @ReadOnlyComposable
    fun display(style: TextStyle): TextStyle {
        val f = factor()
        return style.copy(
            fontSize = style.fontSize * f,
            lineHeight = if (style.lineHeight.isUnspecified) style.lineHeight else style.lineHeight * f,
        )
    }
}
