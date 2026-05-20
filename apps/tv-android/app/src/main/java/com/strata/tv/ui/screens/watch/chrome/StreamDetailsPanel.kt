package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.Format
import androidx.tv.material3.Text
import com.strata.tv.data.StreamPlan
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataType

/**
 * Read-only diagnostic panel. Mirrors Apple's `StreamDetailsPanel`:
 * codec / bitrate / resolution / container so the user (or a debugger)
 * can confirm what the player is actually decoding. Useful for telling
 * direct-play apart from transcode in the field.
 */
@Composable
fun StreamDetailsPanel(
    plan: StreamPlan,
    videoFormat: Format?,
    audioFormat: Format?,
    onDismiss: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxSize().background(StrataColors.Bg.copy(alpha = 0.5f))) {
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .widthIn(min = 420.dp, max = 520.dp)
                .background(StrataColors.Bg2)
                .border(width = 1.dp, color = StrataColors.PanelBorder),
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                Text(
                    text = "STREAM",
                    color = StrataColors.Paper,
                    style = TextStyle(
                        fontFamily = StrataType.Mono,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 3.sp,
                    ),
                )
                Spacer(Modifier.height(12.dp))
                Field(label = "Mode", value = if (plan.preferHls) "HLS transcode" else "Direct play")
                Field(label = "URL", value = if (plan.preferHls) "m3u8" else "stream")
                Field(label = "Bitrate", value = plan.bitrate?.let { "${it / 1000} kbps" } ?: "—")
                videoFormat?.let { format ->
                    Field(
                        label = "Video",
                        value = listOfNotNull(
                            format.sampleMimeType?.substringAfter('/'),
                            format.width.takeIf { it > 0 }?.let { "${it}×${format.height}" },
                        ).joinToString(" · ").ifEmpty { "—" },
                    )
                }
                audioFormat?.let { format ->
                    Field(
                        label = "Audio",
                        value = listOfNotNull(
                            format.sampleMimeType?.substringAfter('/'),
                            format.channelCount.takeIf { it > 0 }?.let { "${it} ch" },
                            format.sampleRate.takeIf { it > 0 }?.let { "${it / 1000} kHz" },
                        ).joinToString(" · ").ifEmpty { "—" },
                    )
                }
                Field(label = "Session", value = plan.playSessionId.takeLast(12))
                Spacer(Modifier.height(16.dp))
                Row(
                    horizontalArrangement = Arrangement.End,
                    modifier = Modifier.padding(top = 8.dp),
                ) {
                    Spacer(Modifier.weight(1f))
                    CloseChip(onClick = onDismiss)
                }
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String) {
    Row(
        modifier = Modifier.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label.uppercase(),
            color = StrataColors.Paper.copy(alpha = 0.45f),
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 10.sp,
                letterSpacing = 1.8.sp,
                fontWeight = FontWeight.SemiBold,
            ),
            modifier = Modifier.padding(end = 18.dp),
        )
        Text(
            text = value,
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 12.sp,
                letterSpacing = 1.4.sp,
            ),
        )
    }
}

@Composable
private fun CloseChip(onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.3f),
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(
            text = "CLOSE",
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 10.sp,
                letterSpacing = 2.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        )
    }
}
