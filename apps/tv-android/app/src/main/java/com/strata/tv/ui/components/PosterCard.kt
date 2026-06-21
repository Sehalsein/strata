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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Alignment
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.paletteFor
import org.jellyfin.sdk.model.api.BaseItemDto
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

    // The focus target (this outer Column) is NOT scaled: its layout bounds stay
    // constant whether or not it's focused. The visual zoom lives on an inner
    // wrapper below. This matters because `bringIntoView` propagates the focused
    // node's bounds up to the parent TvLazyColumn — if those bounds grew on focus
    // the column would re-pivot vertically on every horizontal D-pad press, which
    // is what made the page "jump up and down" while scrolling a row.
    Column(
        modifier = modifier
            .width(width)
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
      Column(modifier = Modifier.scale(scale)) {
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
                // Cover (center-crop) so a non-portrait source — e.g. an episode
                // still — fills the poster frame instead of letterboxing with bands.
                contentScale = ContentScale.Crop,
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
}

/**
 * Landscape (16:9) variant of [PosterCard] for items shown as a scene still
 * rather than a portrait poster — episodes in Continue Watching / Next Up. Sized
 * to [imageHeight] so it lines up with the portrait posters in the same row; its
 * width follows the 16:9 ratio.
 */
@Composable
fun SceneCard(
    item: BaseItemDto,
    imageModel: Any?,
    title: String,
    subtitle: String?,
    imageHeight: Dp,
    modifier: Modifier = Modifier,
    // 0f hides the bar; otherwise a resume progress underline (Continue Watching).
    progress: Float = 0f,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        targetValue = if (focused) 1.06f else 1f,
        animationSpec = tween(durationMillis = 130),
        label = "scene-scale",
    )
    val palette = paletteFor(item.id.toString())
    val interaction = remember { MutableInteractionSource() }
    val model = imageModel
    // Width follows the 16:9 ratio off the shared row image height.
    val cardWidth = imageHeight * (16f / 9f)

    Column(
        modifier = modifier
            .width(cardWidth)
            .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
      Column(modifier = Modifier.scale(scale)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(imageHeight)
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
                model = model,
                contentDescription = title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // Resume progress underline (Continue Watching).
            if (progress > 0f) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .height(4.dp)
                        .background(StrataColors.Bg.copy(alpha = 0.6f)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(progress.coerceIn(0f, 1f))
                            .background(StrataColors.Accent2),
                    )
                }
            }
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
}
