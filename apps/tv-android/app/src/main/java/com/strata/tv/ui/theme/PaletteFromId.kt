package com.strata.tv.ui.theme

import kotlin.math.absoluteValue

/**
 * Port of `apps/web/src/strata/theme.ts:hashStr`. JS computes
 * `((h << 5) - h + charCode) | 0`, i.e. 32-bit signed wrap. We match
 * by doing the math in `Int` (Kotlin's 32-bit) and absolute-valuing
 * the result. Ensures the *same Jellyfin item id* maps to the same
 * palette/motif on web and TV.
 */
private fun hashStr(s: String): Int {
    var h = 0
    for (i in s.indices) {
        h = ((h shl 5) - h + s[i].code) // Int math wraps to 32-bit
    }
    return h.absoluteValue
}

fun paletteFor(key: String): StrataPalette =
    StrataPalettes[hashStr(key) % StrataPalettes.size]

fun motifFor(key: String): StrataMotif =
    StrataMotif.entries[hashStr(key + "::motif") % StrataMotif.entries.size]

fun opusFor(key: String): String = ((hashStr(key) % 899) + 100).toString()
