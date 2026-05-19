package com.strata.tv.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Direct port of `apps/web/src/strata/theme.ts` palettes. Order is
 * load-bearing: `paletteFor()` uses `hashStr(key) % size`, and the
 * web app's hash must yield the same index here so the same item
 * resolves to the same palette on both clients.
 */
data class StrataPalette(val c1: Color, val c2: Color, val c3: Color)

val StrataPalettes: List<StrataPalette> = listOf(
    StrataPalette(c("#c2683a"), c("#1a0d05"), c("#f0c987")),
    StrataPalette(c("#a72a1f"), c("#1a0a08"), c("#f4d77c")),
    StrataPalette(c("#3a2412"), c("#d97c2b"), c("#f4e5c7")),
    StrataPalette(c("#2a0e0e"), c("#c83e2a"), c("#f4d77c")),
    StrataPalette(c("#1a1612"), c("#d97c2b"), c("#f4e5c7")),
    StrataPalette(c("#5a4030"), c("#1a1410"), c("#d8a868")),
    StrataPalette(c("#6a2818"), c("#f0d088"), c("#1a0a05")),
    StrataPalette(c("#1a3a3a"), c("#7ec8c0"), c("#0e1a1a")),
    StrataPalette(c("#0d2a4a"), c("#7ec8f0"), c("#f5f1eb")),
    StrataPalette(c("#3a5a3a"), c("#f4c87a"), c("#1a0e2a")),
    StrataPalette(c("#6a1818"), c("#1a0a0a"), c("#f0c8a8")),
    StrataPalette(c("#1a3a4a"), c("#c87a3a"), c("#0a1a2a")),
    StrataPalette(c("#d97c2b"), c("#1a0a0a"), c("#7ec0d0")),
    StrataPalette(c("#0a1a2a"), c("#c87a3a"), c("#1a0e2a")),
    StrataPalette(c("#3a2a6a"), c("#f4c87a"), c("#1a0e2a")),
    StrataPalette(c("#6a4818"), c("#1a0a05"), c("#f0c060")),
    StrataPalette(c("#3a3a1a"), c("#1a1a0a"), c("#f4c84a")),
    StrataPalette(c("#1a2a1a"), c("#3aa860"), c("#f4e8c2")),
)

object StrataColors {
    val Bg = c("#0c0a08")
    val Bg2 = c("#1a1611")
    val Paper = c("#f3e9d3")
    val Accent = c("#e8331f")
    val Accent2 = c("#e8b341")
    val Ink = c("#1a1410")
    val Dim = Color(0xFF776A5A)
    val PanelBorder = Color(0x1FF3E9D3)
}

private fun c(hex: String): Color {
    val s = hex.removePrefix("#")
    return when (s.length) {
        6 -> Color(0xFF000000 or s.toLong(16))
        8 -> Color(s.toLong(16))
        else -> error("bad hex: $hex")
    }
}
