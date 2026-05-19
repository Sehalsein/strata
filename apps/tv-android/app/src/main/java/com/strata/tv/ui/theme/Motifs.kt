package com.strata.tv.ui.theme

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import kotlin.math.min
import kotlin.math.sin

/**
 * Port of `apps/web/src/strata/Poster.tsx` motif enum. The web app
 * picks one of 18 procedural SVGs per item to give backdrops an
 * editorial, hand-illustrated quality. The TV variant restricts
 * these to hero / detail / watch backgrounds (per the plan) — grids
 * use plain ambient gradient. Geometry is intentionally simple:
 * legible at 10 ft, drawn in palette tones at low alpha. Stroke
 * widths are in pixels (1f-3f) — fine for decorative use.
 */
enum class StrataMotif {
    SUN_HORIZON, CORRIDOR, ATOM, RISING_SUN, BANDS, SPLIT,
    NEON, TWIN_ARC, ARCHWAY, RINGS, AURORA, COURT,
    EYE, MOON_PRAIRIE, FLAG_TORN, VAULT, POD, MEGACITY,
}

@Composable
fun MotifBackdrop(
    motif: StrataMotif,
    palette: StrataPalette,
    modifier: Modifier = Modifier,
    intensity: Float = 0.6f,
) {
    Canvas(modifier = modifier) {
        val ink = palette.c3.copy(alpha = 0.18f * intensity)
        val accent = palette.c2.copy(alpha = 0.32f * intensity)
        val w = size.width
        val h = size.height
        when (motif) {
            StrataMotif.SUN_HORIZON, StrataMotif.RISING_SUN -> {
                val cx = w * 0.5f
                val cy = h * 0.85f
                val r = min(w, h) * 0.55f
                for (i in 1..6) {
                    drawCircle(accent, radius = r * (i / 6f), center = Offset(cx, cy),
                        style = Stroke(width = 2f))
                }
            }
            StrataMotif.CORRIDOR, StrataMotif.ARCHWAY, StrataMotif.VAULT -> {
                val cx = w * 0.5f
                for (i in 1..7) {
                    val frac = i / 7f
                    val width = w * (1f - frac * 0.7f)
                    val left = cx - width / 2
                    val top = h * 0.15f + (h * 0.7f * frac)
                    drawLine(ink, Offset(left, top), Offset(left + width, top),
                        strokeWidth = 1.5f)
                }
            }
            StrataMotif.ATOM, StrataMotif.RINGS, StrataMotif.POD -> {
                val cx = w * 0.5f
                val cy = h * 0.5f
                val r = min(w, h) * 0.32f
                drawCircle(accent, radius = r, center = Offset(cx, cy),
                    style = Stroke(width = 2f))
                drawCircle(ink, radius = r * 1.4f, center = Offset(cx, cy),
                    style = Stroke(width = 1f))
                drawCircle(ink, radius = r * 1.8f, center = Offset(cx, cy),
                    style = Stroke(width = 1f))
            }
            StrataMotif.BANDS, StrataMotif.SPLIT, StrataMotif.FLAG_TORN -> {
                val n = 9
                for (i in 0 until n) {
                    val y = h * (i + 0.5f) / n
                    val width = w * if (i % 2 == 0) 0.85f else 0.55f
                    drawLine(if (i % 2 == 0) accent else ink,
                        Offset(w * 0.5f - width / 2, y),
                        Offset(w * 0.5f + width / 2, y),
                        strokeWidth = 6f)
                }
            }
            StrataMotif.NEON, StrataMotif.AURORA -> {
                val baseY = h * 0.55f
                val amp = h * 0.18f
                val steps = 80
                for (band in 0..2) {
                    val color = if (band == 1) accent else ink
                    var prev = Offset(0f, baseY + band * 10)
                    for (i in 1..steps) {
                        val x = w * (i / steps.toFloat())
                        val y = baseY + band * 12 + (sin(i * 0.18 + band) * amp).toFloat()
                        drawLine(color, prev, Offset(x, y), strokeWidth = 2f)
                        prev = Offset(x, y)
                    }
                }
            }
            StrataMotif.TWIN_ARC -> {
                for (side in listOf(0.3f, 0.7f)) {
                    drawCircle(accent, radius = min(w, h) * 0.4f,
                        center = Offset(w * side, h * 0.6f),
                        style = Stroke(width = 2f))
                }
            }
            StrataMotif.COURT, StrataMotif.MEGACITY -> {
                val cols = 7
                for (i in 0..cols) {
                    val x = w * (i / cols.toFloat())
                    drawLine(ink, Offset(x, h * 0.3f), Offset(x, h), strokeWidth = 1.5f)
                }
                drawLine(accent, Offset(0f, h * 0.3f), Offset(w, h * 0.3f), strokeWidth = 2f)
            }
            StrataMotif.EYE -> {
                val cx = w * 0.5f
                val cy = h * 0.5f
                drawCircle(accent, radius = min(w, h) * 0.28f, center = Offset(cx, cy),
                    style = Stroke(width = 2f))
                drawCircle(ink, radius = min(w, h) * 0.12f, center = Offset(cx, cy))
            }
            StrataMotif.MOON_PRAIRIE -> {
                drawCircle(accent, radius = min(w, h) * 0.18f,
                    center = Offset(w * 0.75f, h * 0.3f), style = Stroke(width = 2f))
                for (i in 0..6) {
                    val y = h * (0.6f + i * 0.05f)
                    drawLine(ink, Offset(0f, y), Offset(w, y), strokeWidth = 1f)
                }
            }
        }
    }
}
