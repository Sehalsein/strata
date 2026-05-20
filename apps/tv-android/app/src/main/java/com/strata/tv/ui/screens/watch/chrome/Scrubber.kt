package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import com.strata.tv.ui.theme.StrataColors

/**
 * Focus-driven scrubber. Left/Right step 10s, Page Up/Down step 60s, OK
 * toggles play/pause. While focused, the scrubber's `onScrubbing` is
 * called continuously so the chrome can render a trickplay tooltip and
 * auto-hide timer can be reset.
 *
 * Two interaction models on TV: directional scrub (current implementation,
 * D-pad steps) and absolute scrub (touchscreen drag). We only do the
 * directional model — TV remotes don't have a touchpad surface the user
 * can drag along.
 */
@Composable
fun Scrubber(
    positionMs: Long,
    durationMs: Long,
    modifier: Modifier = Modifier,
    onSeek: (Long) -> Unit,
    onScrubChange: (Long?) -> Unit,
    onTogglePlay: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    var scrubPos by remember(positionMs) { mutableStateOf<Long?>(null) }
    val effective = scrubPos ?: positionMs
    val fraction = if (durationMs > 0) {
        (effective.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
    } else 0f

    LaunchedEffect(focused) {
        if (!focused) scrubPos = null
        onScrubChange(scrubPos)
    }

    val barColor = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.5f)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(28.dp)
            .padding(vertical = 10.dp)
            .focusable(interactionSource = remember { MutableInteractionSource() })
            .onFocusChanged { focused = it.isFocused }
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (event.key) {
                    Key.DirectionLeft -> {
                        val next = (effective - 10_000L).coerceAtLeast(0L)
                        scrubPos = next
                        onScrubChange(next)
                        onSeek(next)
                        true
                    }
                    Key.DirectionRight -> {
                        val next = (effective + 10_000L).coerceAtMost(durationMs)
                        scrubPos = next
                        onScrubChange(next)
                        onSeek(next)
                        true
                    }
                    Key.MediaFastForward, Key.PageDown -> {
                        val next = (effective + 60_000L).coerceAtMost(durationMs)
                        scrubPos = next
                        onScrubChange(next)
                        onSeek(next)
                        true
                    }
                    Key.MediaRewind, Key.PageUp -> {
                        val next = (effective - 60_000L).coerceAtLeast(0L)
                        scrubPos = next
                        onScrubChange(next)
                        onSeek(next)
                        true
                    }
                    Key.DirectionCenter, Key.Enter, Key.MediaPlayPause -> {
                        onTogglePlay()
                        true
                    }
                    else -> false
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(if (focused) 4.dp else 2.dp)
                .background(StrataColors.Paper.copy(alpha = 0.15f)),
        )
        Box(
            modifier = Modifier
                .fillMaxWidth(fraction)
                .height(if (focused) 4.dp else 2.dp)
                .background(barColor),
        )
        // Playhead dot
        Box(
            modifier = Modifier
                .fillMaxWidth(fraction)
                .height(if (focused) 4.dp else 2.dp),
            contentAlignment = Alignment.CenterEnd,
        ) {
            Box(
                modifier = Modifier
                    .background(
                        if (focused) StrataColors.Accent else Color.Transparent,
                    )
                    .height(if (focused) 16.dp else 0.dp)
                    .padding(horizontal = 1.dp),
            )
        }
    }
}
