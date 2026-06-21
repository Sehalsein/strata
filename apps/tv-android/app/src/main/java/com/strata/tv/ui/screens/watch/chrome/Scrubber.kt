package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import com.strata.tv.ui.theme.StrataColors

/**
 * Jellyfin-style seek bar. Full-width track with a buffered underlay, a
 * filled progress portion, intro/credits segment ticks, and a thumb that
 * grows when focused. Left/Right step 10s, Page/FF/RW step 60s, OK toggles
 * play/pause. DPAD up/down deliberately fall through (return false) so focus
 * can move to the transport buttons above.
 *
 * While focused the scrub position is reported via `onScrubChange` so the
 * chrome can show a trickplay preview (rendered here, following the thumb)
 * and keep the auto-hide timer alive.
 *
 * Directional scrub only — TV remotes have no drag surface.
 */
@Composable
fun Scrubber(
    positionMs: Long,
    durationMs: Long,
    bufferedMs: Long,
    segments: List<SkipSegment>,
    modifier: Modifier = Modifier,
    onSeek: (Long) -> Unit,
    onScrubChange: (Long?) -> Unit,
    onTogglePlay: () -> Unit,
    preview: (@Composable (positionMs: Long) -> Unit)? = null,
) {
    var focused by remember { mutableStateOf(false) }
    var scrubPos by remember(positionMs) { mutableStateOf<Long?>(null) }
    val effective = scrubPos ?: positionMs
    val fraction = if (durationMs > 0) {
        (effective.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
    } else 0f
    val bufferedFraction = if (durationMs > 0) {
        (bufferedMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
    } else 0f

    LaunchedEffect(focused) {
        if (!focused) scrubPos = null
        onScrubChange(scrubPos)
    }

    val trackHeight by animateDpAsState(if (focused) 6.dp else 3.dp, label = "track-h")
    val thumbSize by animateDpAsState(if (focused) 18.dp else 0.dp, label = "thumb")
    val previewWidth = 240.dp

    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(40.dp)
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
        val widthDp = maxWidth

        // Track background
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(trackHeight)
                .clip(CircleShape)
                .background(StrataColors.Paper.copy(alpha = 0.18f)),
        )
        // Buffered underlay
        Box(
            modifier = Modifier
                .fillMaxWidth(bufferedFraction)
                .height(trackHeight)
                .clip(CircleShape)
                .background(StrataColors.Paper.copy(alpha = 0.30f)),
        )
        // Played portion
        Box(
            modifier = Modifier
                .fillMaxWidth(fraction)
                .height(trackHeight)
                .clip(CircleShape)
                .background(StrataColors.Accent),
        )

        // Intro / credits segment ticks
        if (durationMs > 0) {
            segments.forEach { seg ->
                val start = (seg.startMs.toFloat() / durationMs).coerceIn(0f, 1f)
                Box(
                    modifier = Modifier
                        .offset(x = widthDp * start)
                        .height(trackHeight + 4.dp)
                        .width(2.dp)
                        .background(StrataColors.Accent2.copy(alpha = 0.85f)),
                )
            }
        }

        // Thumb
        Box(
            modifier = Modifier
                .offset(x = widthDp * fraction - thumbSize / 2)
                .size(thumbSize)
                .clip(CircleShape)
                .background(StrataColors.Paper),
        )

        // Trickplay preview, centered over the thumb, clamped to the bar.
        if (preview != null) {
            AnimatedVisibility(
                visible = focused && scrubPos != null,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                val rawX = widthDp * fraction - previewWidth / 2
                val maxX = widthDp - previewWidth
                val clampedX = rawX.coerceIn(0.dp, if (maxX > 0.dp) maxX else 0.dp)
                Box(
                    modifier = Modifier
                        .offset(x = clampedX, y = (-150).dp)
                        .clip(RoundedCornerShape(6.dp)),
                ) {
                    preview(effective)
                }
            }
        }
    }
}
