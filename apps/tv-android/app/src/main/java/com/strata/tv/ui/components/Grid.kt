package com.strata.tv.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRestorer
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
    columns: Int = 5,
    firstFocusRequester: FocusRequester? = null,
) {
    TvLazyVerticalGrid(
        columns = TvGridCells.Fixed(columns),
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
    firstFocusRequester: FocusRequester? = null,
) {
    TvLazyRow(
        // Pivot 0.1: focused poster sits 10% from the left, keeping the next
        // two posters visible to its right. Matches the "trail to come" feel
        // of tvOS shelves.
        pivotOffsets = PivotOffsets(parentFraction = 0.1f),
        modifier = modifier
            .fillMaxWidth()
            .focusRestorer(),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 16.dp),
    ) {
        itemsIndexed(items, key = { _, it -> it.id.toString() }) { idx, item ->
            PosterCard(
                itemId = item.id,
                title = item.name.orEmpty(),
                subtitle = item.seriesName ?: item.productionYear?.toString(),
                focusRequester = if (idx == 0) firstFocusRequester else null,
                onClick = { onSelect(item) },
            )
        }
    }
}
