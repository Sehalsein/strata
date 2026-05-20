package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.foundation.lazy.list.items
import androidx.tv.material3.Text
import com.strata.tv.data.AudioStream
import com.strata.tv.data.SubtitleStream
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataType

/**
 * Audio + subtitle picker overlays. Rendered as a focus-trapped sheet
 * docked to the right of the screen so the video stays visible behind. The
 * caller toggles visibility from `ChromeHost` — Back / OK on the close
 * button dismisses.
 */
@Composable
fun AudioMenu(
    tracks: List<AudioStream>,
    selectedIndex: Int?,
    onSelect: (AudioStream) -> Unit,
    onDismiss: () -> Unit,
) {
    MenuSheet(title = "Audio", onDismiss = onDismiss) {
        TvLazyColumn(modifier = Modifier.fillMaxSize()) {
            items(tracks, key = { it.index }) { track ->
                TrackRow(
                    title = track.displayTitle ?: track.language ?: "Track ${track.index}",
                    subtitle = listOfNotNull(track.codec, track.channels?.let { "$it ch" })
                        .joinToString(" · ")
                        .ifBlank { null },
                    isSelected = track.index == selectedIndex,
                    onClick = { onSelect(track) },
                )
            }
        }
    }
}

@Composable
fun SubtitleMenu(
    tracks: List<SubtitleStream>,
    selectedIndex: Int?,
    onSelect: (SubtitleStream?) -> Unit,
    onDismiss: () -> Unit,
) {
    MenuSheet(title = "Subtitles", onDismiss = onDismiss) {
        TvLazyColumn(modifier = Modifier.fillMaxSize()) {
            item(key = "off") {
                TrackRow(
                    title = "Off",
                    subtitle = null,
                    isSelected = selectedIndex == null,
                    onClick = { onSelect(null) },
                )
            }
            items(tracks, key = { it.index }) { track ->
                TrackRow(
                    title = track.displayTitle ?: track.language ?: "Subtitle ${track.index}",
                    subtitle = if (track.isExternal) "External" else null,
                    isSelected = track.index == selectedIndex,
                    onClick = { onSelect(track) },
                )
            }
        }
    }
}

@Composable
private fun MenuSheet(title: String, onDismiss: () -> Unit, body: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().background(StrataColors.Bg.copy(alpha = 0.55f))) {
        Box(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .widthIn(min = 360.dp, max = 420.dp)
                .padding(end = 48.dp, top = 80.dp, bottom = 80.dp)
                .background(StrataColors.Bg2)
                .border(width = 1.dp, color = StrataColors.PanelBorder),
        ) {
            Column(modifier = Modifier.fillMaxSize().padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = title.uppercase(),
                        color = StrataColors.Paper,
                        style = TextStyle(
                            fontFamily = StrataType.Mono,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 3.sp,
                        ),
                    )
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.height(1.dp).background(StrataColors.Paper.copy(alpha = 0.18f)).width(80.dp))
                    Spacer(Modifier.weight(1f))
                    CloseButton(onClick = onDismiss)
                }
                Spacer(Modifier.height(16.dp))
                body()
            }
        }
    }
}

@Composable
private fun TrackRow(
    title: String,
    subtitle: String?,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(2.dp))
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.08f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Box(
            modifier = Modifier
                .width(8.dp)
                .height(8.dp)
                .background(if (isSelected) StrataColors.Accent else Color.Transparent),
        )
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                color = if (focused || isSelected) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.75f),
                style = TextStyle(
                    fontFamily = StrataType.Plex,
                    fontSize = 15.sp,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                ),
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    color = StrataColors.Paper.copy(alpha = 0.5f),
                    style = TextStyle(
                        fontFamily = StrataType.Mono,
                        fontSize = 10.sp,
                        letterSpacing = 1.4.sp,
                    ),
                )
            }
        }
    }
}

@Composable
private fun CloseButton(onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(2.dp))
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.3f),
                shape = RoundedCornerShape(2.dp),
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
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
