package com.strata.tv.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.tv.foundation.PivotOffsets
import androidx.tv.foundation.lazy.grid.TvGridCells
import androidx.tv.foundation.lazy.grid.TvGridItemSpan
import androidx.tv.foundation.lazy.grid.TvLazyVerticalGrid
import androidx.tv.foundation.lazy.grid.itemsIndexed
import androidx.tv.foundation.lazy.list.TvLazyRow
import androidx.tv.foundation.lazy.list.itemsIndexed
import com.strata.tv.di.ServiceLocator
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind

@Composable
fun PosterGrid(
    items: List<BaseItemDto>,
    onSelect: (BaseItemDto) -> Unit,
    modifier: Modifier = Modifier,
    // Adaptive: the grid fits as many ~minPosterWidth columns as the screen
    // allows — more on a wide display, fewer on a small box — so poster size
    // stays constant and content density follows the TV. ~104dp yields ~7
    // columns on a 960dp TV (Apple-TV-like density) instead of 5 oversized ones.
    minPosterWidth: Dp = 104.dp,
    firstFocusRequester: FocusRequester? = null,
    // Optional full-width header (screen title + sort row) rendered as the first
    // grid item so it shares the grid's focus + scroll tree — that's what makes
    // D-pad Up from the top poster row land on the sort chips (a sibling above
    // the lazy grid can't be reached reliably; the grid eats the key).
    header: (@Composable () -> Unit)? = null,
) {
    TvLazyVerticalGrid(
        columns = TvGridCells.Adaptive(minPosterWidth),
        // Pivot offset keeps the focused row in the upper part of the grid
        // instead of pinning to the edge — feels closer to Apple TV's "as you
        // walk down, the row scrolls under you" behavior. 0.25 (vs a tighter
        // 0.2) also leaves the header's screen title clear of the floating app
        // bar when the sort row — the header's focusable — is selected.
        pivotOffsets = PivotOffsets(parentFraction = 0.25f),
        modifier = modifier
            .fillMaxWidth()
            .focusRestorer(),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
        // Top padding clears the floating app bar (~84dp tall incl. overscan inset)
        // so the screen title + sort row land fully below it instead of being
        // clipped under the wordmark/tabs; bottom padding keeps the last row's
        // title + focus ring off the screen edge / TV overscan when scrolled.
        contentPadding = PaddingValues(start = 44.dp, end = 44.dp, top = 112.dp, bottom = 88.dp),
    ) {
        if (header != null) {
            item(span = { TvGridItemSpan(maxLineSpan) }) { header() }
        }
        itemsIndexed(items, key = { _, it -> it.id.toString() }) { idx, item ->
            PosterCard(
                itemId = item.id,
                title = item.name.orEmpty(),
                subtitle = item.productionYear?.toString(),
                focusRequester = if (idx == 0) firstFocusRequester else null,
                onClick = { onSelect(item) },
            )
        }
    }
}

/** How a [PosterRow] renders its cards. */
enum class RowStyle {
    /** Portrait poster (default — Latest in <library>, libraries, search). */
    POSTER,
    /** Landscape 16:9 episode still + resume bar — Continue Watching. */
    SCENE,
    /** Landscape 16:9 series key art — Next Up ("wide poster"). */
    WIDE,
}

@Composable
fun PosterRow(
    items: List<BaseItemDto>,
    onSelect: (BaseItemDto) -> Unit,
    modifier: Modifier = Modifier,
    posterWidth: Dp = 118.dp,
    style: RowStyle = RowStyle.POSTER,
    firstFocusRequester: FocusRequester? = null,
) {
    val landscape = style != RowStyle.POSTER
    TvLazyRow(
        // Pivot 0.7 keeps the focused poster right-of-centre so the first several
        // items navigate WITHOUT scrolling. Landscape cards are ~3× wider, so a
        // far-right pivot would push the focused card off the right edge — a
        // lower 0.35 pivot keeps wide cards fully on-screen.
        pivotOffsets = PivotOffsets(parentFraction = if (landscape) 0.35f else 0.7f),
        modifier = modifier
            .fillMaxWidth()
            .focusRestorer(),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        contentPadding = PaddingValues(start = 44.dp, end = 44.dp, top = 12.dp, bottom = 16.dp),
    ) {
        // Shared image height so landscape cards line up with portrait posters in
        // the same row (poster image is 2:3, so height = width * 1.5).
        val imageHeight = posterWidth * 1.5f
        itemsIndexed(items, key = { _, it -> it.id.toString() }) { idx, item ->
            val focusReq = if (idx == 0) firstFocusRequester else null
            val repo = ServiceLocator.repository
            if (landscape) {
                val isEpisode = item.type == BaseItemKind.EPISODE
                val model = when (style) {
                    // Continue Watching: the actual frame you stopped on.
                    RowStyle.SCENE ->
                        if (isEpisode) repo.imageUrls.episodeStill(item) ?: repo.imageUrls.thumb(item.id)
                        else repo.imageUrls.backdrop(item.id)
                    // Next Up: the series' wide key art, not a random frame.
                    RowStyle.WIDE -> repo.imageUrls.backdrop(item.seriesId ?: item.id)
                    RowStyle.POSTER -> null
                }
                SceneCard(
                    item = item,
                    imageModel = model,
                    title = item.name.orEmpty(),
                    subtitle = item.seriesName ?: item.productionYear?.toString(),
                    imageHeight = imageHeight,
                    progress = if (style == RowStyle.SCENE) resumeFraction(item) else 0f,
                    focusRequester = focusReq,
                    onClick = { onSelect(item) },
                )
            } else {
                PosterCard(
                    itemId = item.id,
                    title = item.name.orEmpty(),
                    subtitle = item.seriesName ?: item.productionYear?.toString(),
                    width = posterWidth,
                    focusRequester = focusReq,
                    onClick = { onSelect(item) },
                )
            }
        }
    }
}

/** Fraction watched, for the Continue Watching resume bar. 0 when unknown. */
private fun resumeFraction(item: BaseItemDto): Float {
    val pos = item.userData?.playbackPositionTicks ?: return 0f
    val dur = item.runTimeTicks ?: return 0f
    if (dur <= 0L) return 0f
    return (pos.toFloat() / dur.toFloat()).coerceIn(0f, 1f)
}
