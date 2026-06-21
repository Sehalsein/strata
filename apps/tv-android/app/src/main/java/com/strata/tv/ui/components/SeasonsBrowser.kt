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
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
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
import androidx.tv.foundation.lazy.list.itemsIndexed
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
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
    // Down from a season chip drops onto the first episode card — the lazy
    // column's focus search otherwise skips the episode rail.
    val episodeFocus = remember { FocusRequester() }
    Column(modifier = modifier) {
        SectionHeading(title = "Episodes")
        Spacer(Modifier.height(20.dp))
        if (seasons.isNotEmpty()) {
            TvLazyRow(
                pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.1f),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                // contentPadding keeps the leading chip off the edge while letting
                // the row scroll cleanly to the screen edge (no hard 44dp clip).
                contentPadding = PaddingValues(horizontal = 44.dp),
                modifier = Modifier.focusRestorer(),
            ) {
                items(seasons, key = { it.id.toString() }) { season ->
                    SeasonChip(
                        season = season,
                        isSelected = season.id == selectedSeason?.id,
                        downTarget = if (episodes.isNotEmpty()) episodeFocus else null,
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
                    .padding(horizontal = 44.dp),
            ) {
                Text(
                    text = "No episodes",
                    color = StrataColors.Paper.copy(alpha = 0.45f),
                    style = StrataText.MetaDim,
                )
            }
        } else {
            TvLazyRow(
                pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.7f),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
                // contentPadding so episode cards scroll to the screen edge instead
                // of being cut off at a 44dp gutter when navigating right; the
                // vertical inset keeps the focused card's scaled-up ring from
                // being clipped at the row's top/bottom edge.
                contentPadding = PaddingValues(horizontal = 44.dp, vertical = 8.dp),
                modifier = Modifier.focusRestorer(),
            ) {
                itemsIndexed(episodes, key = { _, it -> it.id.toString() }) { idx, ep ->
                    EpisodeCard(
                        episode = ep,
                        focusRequester = if (idx == 0) episodeFocus else null,
                        onClick = { onSelectEpisode(ep) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SeasonChip(
    season: BaseItemDto,
    isSelected: Boolean,
    downTarget: FocusRequester? = null,
    onSelect: () -> Unit,
) {
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
            .let { if (downTarget != null) it.focusProperties { down = downTarget } else it }
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .border(
                width = 1.dp,
                color = if (isSelected) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.25f),
                shape = RoundedCornerShape(8.dp),
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onSelect)
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Text(
            text = season.name ?: "Season",
            color = fg,
            style = StrataText.Chip,
        )
    }
}

@Composable
private fun EpisodeCard(
    episode: BaseItemDto,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "ep-scale")
    val interaction = remember { MutableInteractionSource() }
    val repo = ServiceLocator.repository

    // Outer Column is the unscaled focus target (stable layout bounds → the
    // parent column doesn't re-pivot vertically as you arrow across the row);
    // the visual zoom lives on the inner wrapper.
    Column(
        modifier = Modifier
            .width(272.dp)
            .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .onFocusChanged { focused = it.isFocused },
    ) {
      Column(modifier = Modifier.scale(scale)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                // Focus ring as the OUTERMOST modifier so the whole stroke renders
                // — a preceding `.clip()` shaves off the outer half and a thin
                // remainder vanishes against a bright still. The matching padding
                // insets the artwork so a dark gap sits between ring and image,
                // making the selected episode unmistakable on any backdrop.
                .border(
                    width = if (focused) 3.dp else 1.dp,
                    color = if (focused) StrataColors.Accent2 else StrataColors.Paper.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(10.dp),
                )
                .padding(if (focused) 4.dp else 1.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(StrataColors.Bg2),
        ) {
            AsyncImage(
                model = repo.imageUrls.episodeStill(episode),
                contentDescription = episode.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // Dim every resting card so the focused episode reads as clearly
            // brighter — the clearest "this one is selected" cue across the row.
            if (!focused) {
                Box(
                    modifier = Modifier
                        .matchParentSize()
                        .background(StrataColors.Bg.copy(alpha = 0.5f)),
                )
            }
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
                    style = StrataText.TimeCode.copy(fontSize = 12.sp),
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            text = episode.name.orEmpty(),
            color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.85f),
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
            style = StrataText.Meta,
            modifier = if (focused) Modifier.basicMarquee(iterations = Int.MAX_VALUE) else Modifier,
        )
        episode.overview?.let {
            Text(
                text = it,
                color = StrataColors.Paper.copy(alpha = 0.55f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = StrataText.CardSub,
            )
        }
        episode.runTimeTicks?.let { ticks ->
            val mins = ticks / 600_000_000L
            Text(
                text = "${mins}m",
                color = StrataColors.Paper.copy(alpha = 0.5f),
                style = StrataText.CardSub,
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
