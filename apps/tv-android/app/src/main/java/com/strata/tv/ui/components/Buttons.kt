package com.strata.tv.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText

/**
 * Shared TV action buttons. One primary (solid Paper) + one secondary (outline),
 * both focus-scaling. Replaces the per-screen SolidActionButton / GhostActionButton /
 * WatchlistButton / BeginButton / OutlineButton copies.
 */
@Composable
fun PrimaryButton(
    label: String,
    modifier: Modifier = Modifier,
    leadingGlyph: String? = "▶",
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "primary-scale")
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = modifier
            .scale(scale)
            .clip(RoundedCornerShape(10.dp))
            .background(if (focused) Color.White else StrataColors.Paper)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 32.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingGlyph != null) {
            Text(text = leadingGlyph, color = StrataColors.Ink, style = StrataText.Button)
            Spacer(Modifier.width(10.dp))
        }
        Text(text = label, color = StrataColors.Ink, style = StrataText.Button)
    }
}

@Composable
fun SecondaryButton(
    label: String,
    modifier: Modifier = Modifier,
    leadingGlyph: String? = null,
    accent: Boolean = false,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "secondary-scale")
    val interaction = remember { MutableInteractionSource() }
    val tint = if (accent) StrataColors.Accent2 else StrataColors.Paper
    val borderColor = when {
        focused -> StrataColors.Paper
        accent -> StrataColors.Accent2
        else -> StrataColors.Paper.copy(alpha = 0.5f)
    }
    val bg = when {
        accent -> StrataColors.Accent2.copy(alpha = 0.12f)
        focused -> StrataColors.Paper.copy(alpha = 0.12f)
        else -> Color.Transparent
    }
    Row(
        modifier = modifier
            .scale(scale)
            .clip(RoundedCornerShape(10.dp))
            .border(width = 1.5.dp, color = borderColor, shape = RoundedCornerShape(10.dp))
            .background(bg)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 28.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingGlyph != null) {
            Text(text = leadingGlyph, color = tint, style = StrataText.Button)
            Spacer(Modifier.width(10.dp))
        }
        Text(text = label, color = tint, style = StrataText.Button)
    }
}
