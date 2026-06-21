package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.strata.tv.ui.screens.watch.chrome.PlayerEngine.Status
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.StrataType

/**
 * Bottom transport chrome, modelled on the Jellyfin Android TV player.
 *
 * Layout (top to bottom inside the bottom gradient):
 *   title · subtitle
 *   [position] ───────────── seek bar ───────────── [duration]
 *   [‹‹10] [▶/❚❚] [10››]  ·····  [next] [cc] [audio] [tune]
 *
 * Focus model: the seek bar is the default target (DPAD Left/Right scrub).
 * DPAD Down drops into the transport button row; Up returns to the bar.
 */
@Composable
fun TransportBar(
    title: String,
    subtitle: String?,
    status: Status,
    positionMs: Long,
    durationMs: Long,
    bufferedMs: Long,
    segments: List<SkipSegment>,
    hasNext: Boolean,
    onTogglePlay: () -> Unit,
    onRewind: () -> Unit,
    onForward: () -> Unit,
    onNext: () -> Unit,
    onSeek: (Long) -> Unit,
    onScrubChange: (Long?) -> Unit,
    onAudio: () -> Unit,
    onSubtitles: () -> Unit,
    onInfo: () -> Unit,
    seekFocus: FocusRequester,
    preview: (@Composable (positionMs: Long) -> Unit)? = null,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    0.30f to StrataColors.Bg.copy(alpha = 0.55f),
                    1f to StrataColors.Bg.copy(alpha = 0.96f),
                ),
            )
            .padding(start = 60.dp, end = 60.dp, top = 56.dp, bottom = 36.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = title,
                color = StrataColors.Paper,
                maxLines = 1,
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
            subtitle?.let {
                Spacer(Modifier.width(12.dp))
                Text(
                    text = "· $it",
                    color = StrataColors.Paper.copy(alpha = 0.6f),
                    maxLines = 1,
                    style = StrataText.MetaDim,
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Time(positionMs)
            Spacer(Modifier.width(18.dp))
            Box(modifier = Modifier.weight(1f)) {
                Scrubber(
                    positionMs = positionMs,
                    durationMs = durationMs,
                    bufferedMs = bufferedMs,
                    segments = segments,
                    onSeek = onSeek,
                    onScrubChange = onScrubChange,
                    onTogglePlay = onTogglePlay,
                    preview = preview,
                    modifier = Modifier.focusRequester(seekFocus),
                )
            }
            Spacer(Modifier.width(18.dp))
            Time(durationMs)
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            ControlButton(icon = Icons.Filled.Replay10, contentDescription = "Rewind 10 seconds", onClick = onRewind)
            Spacer(Modifier.width(14.dp))
            ControlButton(
                icon = if (status == Status.Playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = "Play or pause",
                onClick = onTogglePlay,
                primary = true,
            )
            Spacer(Modifier.width(14.dp))
            ControlButton(icon = Icons.Filled.Forward10, contentDescription = "Forward 10 seconds", onClick = onForward)

            Spacer(Modifier.weight(1f))

            if (hasNext) {
                ControlButton(icon = Icons.Filled.SkipNext, contentDescription = "Next episode", onClick = onNext)
                Spacer(Modifier.width(14.dp))
            }
            ControlButton(icon = Icons.Filled.ClosedCaption, contentDescription = "Subtitles", onClick = onSubtitles)
            Spacer(Modifier.width(14.dp))
            ControlButton(icon = Icons.Filled.Audiotrack, contentDescription = "Audio", onClick = onAudio)
            Spacer(Modifier.width(14.dp))
            ControlButton(icon = Icons.Filled.Tune, contentDescription = "Stream info", onClick = onInfo)
        }
    }
}

@Composable
private fun Time(ms: Long) {
    val total = (ms / 1000L).coerceAtLeast(0L)
    val h = total / 3600L
    val m = (total % 3600L) / 60L
    val s = total % 60L
    val text = if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
    Text(text = text, color = StrataColors.Paper, style = StrataText.TimeCode)
}

@Composable
private fun ControlButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    primary: Boolean = false,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.12f else 1f, label = "ctrl-scale")
    val interaction = remember { MutableInteractionSource() }
    val box = if (primary) 56.dp else 46.dp
    val glyph = if (primary) 30.dp else 24.dp
    Box(
        modifier = Modifier
            .scale(scale)
            .size(box)
            .clip(CircleShape)
            .background(
                when {
                    focused -> StrataColors.Paper
                    primary -> StrataColors.Paper.copy(alpha = 0.16f)
                    else -> Color.Transparent
                },
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = if (focused) StrataColors.Ink else StrataColors.Paper,
            modifier = Modifier.size(glyph),
        )
    }
}
