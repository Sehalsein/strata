package com.strata.tv.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.foundation.lazy.list.itemsIndexed
import androidx.tv.material3.Text
import com.strata.tv.data.LibrarySort
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.PosterGrid
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.ItemFilter

/** The query a [LibraryGrid] resolves: sort + optional letter-jump + filters. */
data class LibraryQuery(
    val sort: LibrarySort = LibrarySort.RECENT,
    val nameStartsWith: String? = null,
    val filters: List<ItemFilter> = emptyList(),
)

/** A togglable library filter mapped to a Jellyfin [ItemFilter]. */
private enum class LibraryFilter(val label: String, val filter: ItemFilter) {
    UNWATCHED("Unwatched", ItemFilter.IS_UNPLAYED),
    FAVORITES("Favorites", ItemFilter.IS_FAVORITE),
}

private val ALPHABET = listOf("All") + ('A'..'Z').map { it.toString() }

/**
 * Shared poster-grid screen: an optional letter-jump rail beside a [PosterGrid]
 * whose header carries the title, sort chips, and filter chips. Backs Movies,
 * Shows, a single library view, a Genre, and My List.
 */
@Composable
fun LibraryGrid(
    supportsSort: Boolean,
    onSelect: (BaseItemDto) -> Unit,
    title: String? = null,
    supportsLetterJump: Boolean = false,
    supportsFilters: Boolean = false,
    load: suspend (LibraryQuery) -> List<BaseItemDto>,
) {
    var sort by remember { mutableStateOf(LibrarySort.RECENT) }
    var letter by remember { mutableStateOf<String?>(null) }
    var activeFilters by remember { mutableStateOf(emptySet<LibraryFilter>()) }
    val query = LibraryQuery(
        sort = sort,
        nameStartsWith = letter,
        filters = activeFilters.map { it.filter },
    )
    val data by loadable(sort, letter, activeFilters) { load(query) }
    val focus = remember { FocusRequester() }
    val sortFocus = remember { FocusRequester() }
    // Focus the header chips on the FIRST load only — keeps the title + chips on
    // screen (focusing a poster would scroll the header under the app bar) and
    // doesn't yank focus back when a letter/filter re-queries the grid.
    var initialFocusDone by remember { mutableStateOf(false) }
    LaunchedEffect(data) {
        if (data is Loadable.Ready && !initialFocusDone) {
            initialFocusDone = true
            runCatching {
                if (supportsSort) sortFocus.requestFocus() else focus.requestFocus()
            }
        }
    }

    val grid: @Composable (List<BaseItemDto>) -> Unit = { items ->
        PosterGrid(
            items = items,
            onSelect = onSelect,
            firstFocusRequester = focus,
            modifier = Modifier.fillMaxSize(),
            // Title + sort + filters ride inside the grid as a full-width header
            // so they share its focus/scroll tree — that's what lets D-pad Up
            // from the first poster row reach the chips.
            header = {
                Column(modifier = Modifier.padding(bottom = 8.dp)) {
                    if (title != null) {
                        Text(
                            text = title,
                            color = StrataColors.Paper,
                            style = StrataText.ScreenTitle,
                            modifier = Modifier.padding(start = 44.dp, bottom = 10.dp),
                        )
                    }
                    if (supportsSort || supportsFilters) {
                        ChipBar(
                            supportsSort = supportsSort,
                            sort = sort,
                            onSort = { sort = it },
                            supportsFilters = supportsFilters,
                            activeFilters = activeFilters,
                            onToggleFilter = { f ->
                                activeFilters =
                                    if (f in activeFilters) activeFilters - f else activeFilters + f
                            },
                            firstFocus = sortFocus,
                        )
                    }
                }
            },
        )
    }

    when (val l = data) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> {
            if (supportsLetterJump) {
                // First chip is the explicit Left-exit target from the grid — we
                // point Left directly at a chip (not the rail container) so focus
                // reliably LANDS on a letter and holds, instead of the container
                // absorbing it and leaking the next key back to the grid.
                val firstChipFocus = remember { FocusRequester() }
                Row(modifier = Modifier.fillMaxSize()) {
                    LetterRail(
                        selected = letter,
                        firstChipFocus = firstChipFocus,
                        rightTarget = focus,
                        onSelect = { letter = if (it == "All") null else it },
                    )
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .focusGroup()
                            // Left past the first poster column exits to the rail.
                            .focusProperties { left = firstChipFocus },
                    ) { grid(l.value) }
                }
            } else {
                grid(l.value)
            }
        }
    }
}

/** Vertical A–Z quick-jump rail on the left. Re-queries with `nameStartsWith`. */
@Composable
private fun LetterRail(
    selected: String?,
    firstChipFocus: FocusRequester,
    rightTarget: FocusRequester,
    onSelect: (String) -> Unit,
) {
    TvLazyColumn(
        modifier = Modifier
            .width(56.dp)
            .fillMaxHeight()
            .focusGroup()
            // Right off any letter jumps into the grid.
            .focusProperties { right = rightTarget },
        // Clear the floating app bar at the top; breathe at the bottom for overscan.
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            top = 112.dp, bottom = 88.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        itemsIndexed(ALPHABET, key = { _, it -> it }) { idx, l ->
            val isSelected = (l == "All" && selected == null) || l == selected
            LetterChip(
                label = l,
                selected = isSelected,
                focusRequester = if (idx == 0) firstChipFocus else null,
                onClick = { onSelect(l) },
            )
        }
    }
}

@Composable
private fun LetterChip(
    label: String,
    selected: Boolean,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    val fg = when {
        focused -> StrataColors.Ink
        selected -> StrataColors.Accent2
        else -> StrataColors.Paper.copy(alpha = 0.55f)
    }
    Box(
        modifier = Modifier
            .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
            .clip(RoundedCornerShape(6.dp))
            .background(if (focused) StrataColors.Paper else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text(text = if (label == "All") "·" else label, color = fg, style = StrataText.Chip)
    }
}

@Composable
private fun ChipBar(
    supportsSort: Boolean,
    sort: LibrarySort,
    onSort: (LibrarySort) -> Unit,
    supportsFilters: Boolean,
    activeFilters: Set<LibraryFilter>,
    onToggleFilter: (LibraryFilter) -> Unit,
    firstFocus: FocusRequester,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .focusGroup()
            .padding(horizontal = 44.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (supportsSort) {
            LibrarySort.entries.forEachIndexed { index, option ->
                Chip(
                    label = option.label,
                    selected = option == sort,
                    focusRequester = if (index == 0) firstFocus else null,
                    onClick = { onSort(option) },
                )
            }
        }
        if (supportsFilters) {
            if (supportsSort) Spacer(Modifier.width(8.dp))
            LibraryFilter.entries.forEach { f ->
                Chip(
                    label = f.label,
                    selected = f in activeFilters,
                    accent = true,
                    onClick = { onToggleFilter(f) },
                )
            }
        }
    }
}

@Composable
private fun Chip(
    label: String,
    selected: Boolean,
    focusRequester: FocusRequester? = null,
    accent: Boolean = false,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.05f else 1f, label = "chip-scale")
    val interaction = remember { MutableInteractionSource() }
    val selectedColor = if (accent) StrataColors.Accent2 else StrataColors.Paper
    Row(
        modifier = Modifier
            .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
            .scale(scale)
            .clip(RoundedCornerShape(8.dp))
            .border(
                width = 1.dp,
                color = if (focused || selected) selectedColor else StrataColors.Paper.copy(alpha = 0.3f),
                shape = RoundedCornerShape(8.dp),
            )
            .background(
                if (selected) selectedColor.copy(alpha = 0.14f)
                else if (focused) StrataColors.Paper.copy(alpha = 0.06f)
                else Color.Transparent,
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(
            text = label,
            color = if (selected || focused) selectedColor else StrataColors.Paper.copy(alpha = 0.6f),
            style = StrataText.Chip,
        )
    }
}
