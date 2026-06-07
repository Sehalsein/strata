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
import org.jellyfin.sdk.model.api.BaseItemDto

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
        // Pivot offset 0.2 keeps the focused row in the upper part of the grid
        // instead of pinning to the edge — feels closer to Apple TV's "as you
        // walk down, the row scrolls under you" behavior.
        pivotOffsets = PivotOffsets(parentFraction = 0.2f),
        modifier = modifier
            .fillMaxWidth()
            .focusRestorer(),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
        // Top padding clears the floating app bar (the header scrolls under it);
        // bottom padding keeps the last row's title + focus ring off the screen
        // edge / TV overscan when scrolled to the end.
        contentPadding = PaddingValues(start = 44.dp, end = 44.dp, top = 64.dp, bottom = 88.dp),
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

@Composable
fun PosterRow(
    items: List<BaseItemDto>,
    onSelect: (BaseItemDto) -> Unit,
    modifier: Modifier = Modifier,
    posterWidth: Dp = 118.dp,
    firstFocusRequester: FocusRequester? = null,
) {
    TvLazyRow(
        // Pivot 0.4 keeps the focused poster left-of-centre so the first several
        // items can be navigated WITHOUT scrolling the row (the list stays
        // clamped at the start until focus passes the pivot line) — that kills
        // the "whole row shifts on every right-press" jank a far-left pivot
        // causes, while still revealing trailing posters. The row's own
        // contentPadding keeps the first poster's focus ring off the edge.
        pivotOffsets = PivotOffsets(parentFraction = 0.7f),
        modifier = modifier
            .fillMaxWidth()
            .focusRestorer(),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        contentPadding = PaddingValues(start = 44.dp, end = 44.dp, top = 12.dp, bottom = 16.dp),
    ) {
        itemsIndexed(items, key = { _, it -> it.id.toString() }) { idx, item ->
            PosterCard(
                itemId = item.id,
                title = item.name.orEmpty(),
                subtitle = item.seriesName ?: item.productionYear?.toString(),
                width = posterWidth,
                focusRequester = if (idx == 0) firstFocusRequester else null,
                onClick = { onSelect(item) },
            )
        }
    }
}
