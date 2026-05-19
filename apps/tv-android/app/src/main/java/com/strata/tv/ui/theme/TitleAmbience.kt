package com.strata.tv.ui.theme

import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp

/**
 * Port of `apps/web/src/strata/theme.ts:titleAmbience`. Three radial
 * gradients + one vertical linear gradient stacked over the page bg —
 * each tinted from a different palette stop. Caller composes these as
 * `Modifier.background()` layers behind content. The web uses CSS
 * blend; we approximate by sequential `background()` calls with alpha.
 */
@Composable
fun Modifier.titleAmbience(palette: StrataPalette, intensity: Float = 1f): Modifier =
    this
        .background(StrataColors.Bg)
        .background(
            Brush.radialGradient(
                colors = listOf(palette.c1.copy(alpha = 0.32f * intensity), Color.Transparent),
                center = Offset.Unspecified, // resolved by Compose to component center
                radius = Float.POSITIVE_INFINITY,
            ),
        )
        .background(
            Brush.radialGradient(
                colors = listOf(palette.c2.copy(alpha = 0.22f * intensity), Color.Transparent),
            ),
        )
        .background(
            Brush.radialGradient(
                colors = listOf(palette.c3.copy(alpha = 0.14f * intensity), Color.Transparent),
            ),
        )
        .background(
            Brush.verticalGradient(
                0f to palette.c2.copy(alpha = 0.08f * intensity),
                0.6f to Color.Transparent,
            ),
        )

/** Border draw helper for focused cards: thin inner border in palette c2. */
fun DrawScope.drawFocusBorder(color: Color, widthDp: Dp) {
    val px = widthDp.toPx()
    drawRect(
        color = color,
        topLeft = Offset(px / 2, px / 2),
        size = Size(size.width - px, size.height - px),
        style = Stroke(width = px),
    )
}
