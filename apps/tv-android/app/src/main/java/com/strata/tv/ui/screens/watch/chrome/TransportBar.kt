package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.strata.tv.ui.screens.watch.chrome.PlayerEngine.Status
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataType

/**
 * Bottom-anchored transport bar. Layout: a fine spec strip above
 * (now-playing title), then a single row of:
 *   [play/pause]  current-position  ────────── scrubber ──────────  duration
 *                                                            [audio][subs][info]
 *
 * Focus model: play/pause is the default focus target when the chrome
 * shows up cold; once the user starts pressing Right, focus moves through
 * the scrubber and onto the trailing buttons.
 */
@Composable
fun TransportBar(
    title: String,
    subtitle: String?,
    status: Status,
    positionMs: Long,
    durationMs: Long,
    onTogglePlay: () -> Unit,
    onSeek: (Long) -> Unit,
    onScrubChange: (Long?) -> Unit,
    onAudio: () -> Unit,
    onSubtitles: () -> Unit,
    onInfo: () -> Unit,
    playFocus: FocusRequester,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    0.35f to StrataColors.Bg.copy(alpha = 0.6f),
                    1f to StrataColors.Bg.copy(alpha = 0.95f),
                ),
            )
            .padding(horizontal = 60.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .width(28.dp)
                    .height(1.dp)
                    .background(StrataColors.Accent),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = "NOW PLAYING",
                color = StrataColors.Paper.copy(alpha = 0.7f),
                style = TextStyle(
                    fontFamily = StrataType.Mono,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 3.sp,
                ),
            )
            Spacer(Modifier.width(20.dp))
            Text(
                text = title,
                color = StrataColors.Paper,
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
            subtitle?.let {
                Spacer(Modifier.width(10.dp))
                Text(
                    text = "· $it",
                    color = StrataColors.Paper.copy(alpha = 0.55f),
                    style = TextStyle(
                        fontFamily = StrataType.Fraunces,
                        fontSize = 14.sp,
                    ),
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            PlayPauseButton(
                isPlaying = status == Status.Playing,
                modifier = Modifier.focusRequester(playFocus),
                onClick = onTogglePlay,
            )
            Spacer(Modifier.width(20.dp))
            Time(positionMs)
            Spacer(Modifier.width(14.dp))
            Box(modifier = Modifier.weight(1f)) {
                Scrubber(
                    positionMs = positionMs,
                    durationMs = durationMs,
                    onSeek = onSeek,
                    onScrubChange = onScrubChange,
                    onTogglePlay = onTogglePlay,
                )
            }
            Spacer(Modifier.width(14.dp))
            Time(durationMs)
            Spacer(Modifier.width(28.dp))
            ChromeIconButton(label = "AUDIO", onClick = onAudio)
            Spacer(Modifier.width(10.dp))
            ChromeIconButton(label = "CC", onClick = onSubtitles)
            Spacer(Modifier.width(10.dp))
            ChromeIconButton(label = "INFO", onClick = onInfo)
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
    Text(
        text = text,
        color = StrataColors.Paper,
        style = TextStyle(
            fontFamily = StrataType.Mono,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.4.sp,
        ),
    )
}

@Composable
private fun PlayPauseButton(
    isPlaying: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "play-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .scale(scale)
            .clip(RoundedCornerShape(4.dp))
            .background(if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.95f))
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
    ) {
        Text(
            text = if (isPlaying) "❚❚" else "▶",
            color = StrataColors.Ink,
            style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold),
        )
    }
}

@Composable
private fun ChromeIconButton(
    label: String,
    iconWidth: Dp = 56.dp,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "chip-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(RoundedCornerShape(2.dp))
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.35f),
                shape = RoundedCornerShape(2.dp),
            )
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.08f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .width(iconWidth),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 2.sp,
            ),
        )
    }
}
