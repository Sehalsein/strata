package com.strata.tv.ui.components

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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.foundation.lazy.list.TvLazyRow
import androidx.tv.foundation.lazy.list.items
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataType
import org.jellyfin.sdk.model.api.BaseItemDto

/**
 * Editorial seasons strip + horizontal episode rail. Replaces the previous
 * vertical season picker in ShowDetail with a more TV-friendly layout: pick
 * a season at the top, see its episodes scrolling horizontally beneath.
 *
 * Episode cards are 16:9 with a resume-progress underline so an in-progress
 * episode is visible at a glance (mirrors Apple's `EpisodeStrip`).
 */
@Composable
fun SeasonsBrowser(
    seasons: List<BaseItemDto>,
    selectedSeason: BaseItemDto?,
    episodes: List<BaseItemDto>,
    modifier: Modifier = Modifier,
    onSelectSeason: (BaseItemDto) -> Unit,
    onSelectEpisode: (BaseItemDto) -> Unit,
) {
    Column(modifier = modifier) {
        SectionHeading(title = "Episodes", num = "·")
        Spacer(Modifier.height(16.dp))
        if (seasons.isNotEmpty()) {
            TvLazyRow(
                pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.1f),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .padding(horizontal = 48.dp)
                    .focusRestorer(),
            ) {
                items(seasons, key = { it.id.toString() }) { season ->
                    SeasonChip(
                        season = season,
                        isSelected = season.id == selectedSeason?.id,
                        onSelect = { onSelectSeason(season) },
                    )
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        if (episodes.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 48.dp),
            ) {
                Text(
                    text = "No episodes",
                    color = StrataColors.Paper.copy(alpha = 0.45f),
                    style = TextStyle(fontFamily = StrataType.Plex, fontSize = 14.sp),
                )
            }
        } else {
            TvLazyRow(
                pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.1f),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier
                    .padding(horizontal = 48.dp)
                    .focusRestorer(),
            ) {
                items(episodes, key = { it.id.toString() }) { ep ->
                    EpisodeCard(episode = ep, onClick = { onSelectEpisode(ep) })
                }
            }
        }
    }
}

@Composable
private fun SeasonChip(season: BaseItemDto, isSelected: Boolean, onSelect: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    val bg = when {
        isSelected -> StrataColors.Paper
        focused -> StrataColors.Paper.copy(alpha = 0.12f)
        else -> Color.Transparent
    }
    val fg = if (isSelected) StrataColors.Ink else StrataColors.Paper
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(2.dp))
            .background(bg)
            .border(
                width = 1.dp,
                color = if (isSelected) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.25f),
                shape = RoundedCornerShape(2.dp),
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onSelect)
            .padding(horizontal = 18.dp, vertical = 10.dp),
    ) {
        Text(
            text = (season.name ?: "Season").uppercase(),
            color = fg,
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 2.4.sp,
            ),
        )
    }
}

@Composable
private fun EpisodeCard(episode: BaseItemDto, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "ep-scale")
    val interaction = remember { MutableInteractionSource() }
    val repo = ServiceLocator.repository

    Column(
        modifier = Modifier
            .width(300.dp)
            .scale(scale)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .onFocusChanged { focused = it.isFocused },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .clip(RoundedCornerShape(4.dp))
                .background(StrataColors.Bg2)
                .border(
                    width = if (focused) 2.dp else 0.dp,
                    color = if (focused) StrataColors.Accent2 else Color.Transparent,
                    shape = RoundedCornerShape(4.dp),
                ),
        ) {
            AsyncImage(
                model = repo.imageUrls.thumb(episode.id) ?: repo.imageUrls.image(episode.id, maxWidth = 640),
                contentDescription = episode.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // Resume progress underline (Apple parity).
            val resumePct = resumeFraction(episode)
            if (resumePct > 0f) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth(resumePct)
                        .height(3.dp)
                        .background(StrataColors.Accent),
                )
            }
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp)
                    .background(StrataColors.Bg.copy(alpha = 0.65f))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                val s = episode.parentIndexNumber?.toString() ?: "?"
                val e = episode.indexNumber?.toString()?.padStart(2, '0') ?: "??"
                Text(
                    text = "S${s}·E$e",
                    color = StrataColors.Paper,
                    style = TextStyle(
                        fontFamily = StrataType.Mono,
                        fontSize = 10.sp,
                        letterSpacing = 1.6.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(
            text = episode.name.orEmpty(),
            color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.85f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = TextStyle(
                fontFamily = StrataType.Plex,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
            ),
        )
        episode.overview?.let {
            Text(
                text = it,
                color = StrataColors.Paper.copy(alpha = 0.55f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontSize = 12.sp,
                    fontStyle = FontStyle.Italic,
                ),
            )
        }
        episode.runTimeTicks?.let { ticks ->
            val mins = ticks / 600_000_000L
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "${mins}M",
                    color = StrataColors.Paper.copy(alpha = 0.5f),
                    style = TextStyle(
                        fontFamily = StrataType.Mono,
                        fontSize = 10.sp,
                        letterSpacing = 1.6.sp,
                    ),
                )
            }
        }
    }
}

private fun resumeFraction(episode: BaseItemDto): Float {
    val pos = episode.userData?.playbackPositionTicks ?: return 0f
    val total = episode.runTimeTicks ?: return 0f
    if (pos <= 0 || total <= 0) return 0f
    return (pos.toFloat() / total.toFloat()).coerceIn(0f, 1f)
}
