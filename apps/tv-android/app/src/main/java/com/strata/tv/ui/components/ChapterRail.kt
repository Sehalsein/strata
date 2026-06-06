package com.strata.tv.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.foundation.lazy.list.TvLazyRow
import androidx.tv.foundation.lazy.list.itemsIndexed
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.StrataType
import org.jellyfin.sdk.model.api.ChapterInfo
import java.util.UUID

/**
 * Scene-chapter strip rendered on movie detail. Each card is a 16:9
 * Jellyfin chapter thumbnail tagged with the chapter name and mm:ss
 * start time. Selecting jumps the player to that timestamp.
 */
@Composable
fun ChapterRail(
    itemId: UUID,
    chapters: List<ChapterInfo>,
    modifier: Modifier = Modifier,
    onSelect: (ChapterInfo) -> Unit,
) {
    if (chapters.isEmpty()) return
    Column(modifier = modifier) {
        SectionHeading(title = "Chapters", num = "·")
        Spacer(Modifier.height(16.dp))
        TvLazyRow(
            pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.4f),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            modifier = Modifier
                .padding(horizontal = 44.dp)
                .focusRestorer(),
        ) {
            itemsIndexed(chapters) { index, chapter ->
                ChapterCard(itemId = itemId, index = index, chapter = chapter) {
                    onSelect(chapter)
                }
            }
        }
    }
}

@Composable
private fun ChapterCard(itemId: UUID, index: Int, chapter: ChapterInfo, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "chapter-scale")
    val interaction = remember { MutableInteractionSource() }

    Column(
        modifier = Modifier
            .width(240.dp)
            .scale(scale)
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            )
            .onFocusChanged { focused = it.isFocused },
    ) {
        Box(
            modifier = Modifier
                .width(240.dp)
                .aspectRatio(16f / 9f)
                .clip(RoundedCornerShape(8.dp))
                .background(StrataColors.Bg2)
                // Faint resting outline + bold Paper ring on focus (matches the
                // poster / episode cards).
                .border(
                    width = if (focused) 3.dp else 1.dp,
                    color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(8.dp),
                ),
        ) {
            AsyncImage(
                model = ServiceLocator.repository.imageUrls.chapter(itemId, index, maxWidth = 480),
                contentDescription = chapter.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp)
                    .background(StrataColors.Bg.copy(alpha = 0.6f))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    text = formatTicks(chapter.startPositionTicks),
                    color = StrataColors.Paper,
                    style = StrataText.TimeCode.copy(fontSize = 12.sp),
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            text = chapter.name.orEmpty().ifBlank { "Chapter ${index + 1}" },
            color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.75f),
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
            style = StrataText.CardTitle,
            modifier = if (focused) Modifier.basicMarquee(iterations = Int.MAX_VALUE) else Modifier,
        )
    }
}

private fun formatTicks(ticks: Long): String {
    val totalSeconds = ticks / 10_000_000L
    val h = totalSeconds / 3600
    val m = (totalSeconds % 3600) / 60
    val s = totalSeconds % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
