package com.strata.tv.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.paletteFor
import java.util.UUID

@Composable
fun PosterCard(
    itemId: UUID,
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    width: androidx.compose.ui.unit.Dp = 158.dp,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        targetValue = if (focused) 1.06f else 1f,
        animationSpec = tween(durationMillis = 130),
        label = "poster-scale",
    )
    val palette = paletteFor(itemId.toString())
    val interaction = remember { MutableInteractionSource() }

    Column(
        modifier = modifier
            .width(width)
            .scale(scale)
            .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
            .onFocusChanged { focused = it.isFocused }
            // clickable provides focusable + ENTER/DPAD_CENTER handling
            // natively on TV; replaces the focusable() + onPreviewKeyEvent
            // combo which didn't dispatch click in lazy rows.
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(10.dp))
                .background(
                    Brush.verticalGradient(
                        listOf(palette.c1.copy(alpha = 0.6f), palette.c2.copy(alpha = 0.4f)),
                    ),
                )
                .border(
                    width = if (focused) 3.dp else 0.dp,
                    color = if (focused) StrataColors.Paper else Color.Transparent,
                    shape = RoundedCornerShape(10.dp),
                ),
        ) {
            AsyncImage(
                model = ServiceLocator.repository.imageUrls.image(itemId, maxWidth = 480),
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Text(
            text = title,
            color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.75f),
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
            style = StrataText.CardTitle,
            modifier = Modifier
                .padding(top = 8.dp)
                // On focus, a long title scrolls instead of truncating; at rest
                // it ellipsizes.
                .then(if (focused) Modifier.basicMarquee(iterations = Int.MAX_VALUE) else Modifier),
        )
        if (subtitle != null) {
            Text(
                text = subtitle,
                color = StrataColors.Dim,
                style = StrataText.CardSub,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}
