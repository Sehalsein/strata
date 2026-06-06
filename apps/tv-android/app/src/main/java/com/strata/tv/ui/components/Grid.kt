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
    // stays constant and content density follows the TV.
    minPosterWidth: Dp = 132.dp,
    firstFocusRequester: FocusRequester? = null,
) {
    TvLazyVerticalGrid(
        columns = TvGridCells.Adaptive(minPosterWidth),
        // Pivot offset 0.25 keeps the focused row in the upper-third of the
        // grid instead of pinning to the edge — feels closer to Apple TV's
        // "as you walk down, the row scrolls under you" behavior.
        pivotOffsets = PivotOffsets(parentFraction = 0.25f),
        modifier = modifier
            .fillMaxWidth()
            .focusRestorer(),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
        contentPadding = PaddingValues(horizontal = 48.dp, vertical = 24.dp),
    ) {
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
    posterWidth: Dp = 132.dp,
    firstFocusRequester: FocusRequester? = null,
) {
    TvLazyRow(
        // Pivot ~0.06: focused poster sits just in from the left edge, keeping
        // the trailing posters visible. The row fills the full width and carries
        // its own horizontal contentPadding (instead of an outer padded Box) so
        // the first poster's focus ring has room to grow and isn't clipped at
        // the row's left edge. Vertical padding gives the scaled ring headroom.
        pivotOffsets = PivotOffsets(parentFraction = 0.06f),
        modifier = modifier
            .fillMaxWidth()
            .focusRestorer(),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 12.dp, bottom = 16.dp),
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
