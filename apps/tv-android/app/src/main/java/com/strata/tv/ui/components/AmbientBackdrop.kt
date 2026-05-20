package com.strata.tv.ui.components

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.strata.tv.ui.theme.MotifBackdrop
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.motifFor
import com.strata.tv.ui.theme.paletteFor

/**
 * Soft ambient backdrop — palette wash + (on API 31+) a blurred procedural
 * motif. Apple's `AmbientBackdrop` blurs the motif at radius ~40pt; the API
 * 26 floor here means we can't use `Modifier.blur` everywhere, so on older
 * devices we fall back to a tinted gradient only. Content composes on top.
 *
 * Pass an item id to key the palette/motif deterministically — the same id
 * resolves to the same wash on every screen, matching the web.
 */
@Composable
fun AmbientBackdrop(
    itemKey: String?,
    modifier: Modifier = Modifier,
    intensity: Float = 0.45f,
    content: @Composable () -> Unit,
) {
    val palette = itemKey?.let { paletteFor(it) }
    val motif = itemKey?.let { motifFor(it) }
    val supportsBlur = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    Box(modifier = modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(StrataColors.Bg),
        )
        if (palette != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                palette.c1.copy(alpha = 0.22f * intensity),
                                palette.c2.copy(alpha = 0.16f * intensity),
                                Color.Transparent,
                            ),
                        ),
                    ),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0f to Color.Transparent,
                            1f to palette.c2.copy(alpha = 0.08f * intensity),
                        ),
                    ),
            )
            if (motif != null && supportsBlur) {
                MotifBackdrop(
                    motif = motif,
                    palette = palette,
                    intensity = intensity * 0.7f,
                    modifier = Modifier
                        .fillMaxSize()
                        .blur(40.dp),
                )
            }
        }
        content()
    }
}
