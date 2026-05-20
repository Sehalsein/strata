package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataType
import kotlinx.coroutines.delay
import org.jellyfin.sdk.model.api.BaseItemDto

/**
 * Up-next card — slides in bottom-right when current playback is in its
 * last 30 s. Countdown ring runs down, then auto-confirms; OK confirms
 * early, Back dismisses.
 */
@Composable
fun UpNextCard(
    next: BaseItemDto,
    visible: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    countdownMs: Long = 30_000L,
) {
    var remainingMs by remember(visible, next.id) {
        mutableStateOf(if (visible) countdownMs else 0L)
    }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(visible) {
        if (!visible) return@LaunchedEffect
        runCatching { focusRequester.requestFocus() }
        while (remainingMs > 0) {
            delay(100)
            remainingMs -= 100
        }
        onConfirm()
    }

    AnimatedVisibility(
        visible = visible,
        enter = slideInHorizontally(animationSpec = tween(280)) { it },
        exit = slideOutHorizontally(animationSpec = tween(200)) { it },
        modifier = modifier,
    ) {
        var focused by remember { mutableStateOf(false) }
        val interaction = remember { MutableInteractionSource() }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .padding(end = 48.dp, bottom = 120.dp)
                .background(StrataColors.Bg.copy(alpha = 0.88f))
                .border(
                    width = 1.dp,
                    color = if (focused) StrataColors.Paper else StrataColors.PanelBorder,
                )
                .focusRequester(focusRequester)
                .onFocusChanged { focused = it.isFocused }
                .clickable(interactionSource = interaction, indication = null, onClick = onConfirm)
                .padding(16.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(width = 160.dp, height = 90.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(StrataColors.Bg2),
            ) {
                AsyncImage(
                    model = ServiceLocator.repository.imageUrls.thumb(next.id)
                        ?: ServiceLocator.repository.imageUrls.image(next.id, maxWidth = 480),
                    contentDescription = next.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Spacer(Modifier.width(16.dp))
            Column(
                modifier = Modifier.width(260.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = "UP NEXT",
                    color = StrataColors.Accent,
                    style = TextStyle(
                        fontFamily = StrataType.Mono,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 2.8.sp,
                    ),
                )
                Text(
                    text = next.name.orEmpty(),
                    color = StrataColors.Paper,
                    maxLines = 2,
                    style = TextStyle(
                        fontFamily = StrataType.Fraunces,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Medium,
                    ),
                )
                next.seriesName?.let { series ->
                    Text(
                        text = series,
                        color = StrataColors.Paper.copy(alpha = 0.55f),
                        maxLines = 1,
                        style = TextStyle(
                            fontFamily = StrataType.Fraunces,
                            fontStyle = FontStyle.Italic,
                            fontSize = 13.sp,
                        ),
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "Plays in ${(remainingMs / 1000).coerceAtLeast(0)}s",
                        color = StrataColors.Paper.copy(alpha = 0.6f),
                        style = TextStyle(
                            fontFamily = StrataType.Mono,
                            fontSize = 10.sp,
                            letterSpacing = 1.6.sp,
                        ),
                    )
                    Spacer(Modifier.weight(1f))
                    DismissChip(onClick = onDismiss)
                }
            }
        }
    }
}

@Composable
private fun DismissChip(onClick: () -> Unit) {
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
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            text = "DISMISS",
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 9.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 2.sp,
            ),
        )
    }
}
