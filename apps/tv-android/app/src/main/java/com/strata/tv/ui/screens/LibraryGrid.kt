package com.strata.tv.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.focusGroup
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.strata.tv.data.LibrarySort
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.PosterGrid
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.StrataType
import org.jellyfin.sdk.model.api.BaseItemDto

/**
 * Shared poster-grid screen: an optional sort row over a [PosterGrid], with
 * loading/error states. Backs Movies, Shows, a single Genre, and My List —
 * mirrors the Apple app's `LibraryScreen`.
 */
@Composable
fun LibraryGrid(
    supportsSort: Boolean,
    onSelect: (BaseItemDto) -> Unit,
    title: String? = null,
    load: suspend (LibrarySort) -> List<BaseItemDto>,
) {
    var sort by remember { mutableStateOf(LibrarySort.RECENT) }
    val data by loadable(sort) { load(sort) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(data) {
        if (data is Loadable.Ready) runCatching { focus.requestFocus() }
    }

    // Top inset clears the floating app bar (content is full-bleed now, so grid
    // screens must start below it — unlike the hero screens which bleed up).
    Column(modifier = Modifier.fillMaxSize().padding(top = 72.dp)) {
        if (title != null) {
            Text(
                text = title,
                color = StrataColors.Paper,
                style = StrataText.ScreenTitle,
                modifier = Modifier.padding(start = 56.dp, top = 8.dp, bottom = 8.dp),
            )
        }
        if (supportsSort) {
            SortRow(current = sort, onSelect = { sort = it })
        }
        when (val l = data) {
            is Loadable.Loading -> LoadingCenter()
            is Loadable.Error -> ErrorCenter(l.cause)
            is Loadable.Ready -> PosterGrid(
                items = l.value,
                onSelect = onSelect,
                firstFocusRequester = focus,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun SortRow(current: LibrarySort, onSelect: (LibrarySort) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .focusGroup()
            .padding(horizontal = 56.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LibrarySort.entries.forEach { option ->
            SortChip(
                label = option.label,
                selected = option == current,
                onClick = { onSelect(option) },
            )
        }
    }
}

@Composable
private fun SortChip(label: String, selected: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.05f else 1f, label = "sort-scale")
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .scale(scale)
            .clip(RoundedCornerShape(8.dp))
            .border(
                width = 1.dp,
                color = if (focused || selected) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.3f),
                shape = RoundedCornerShape(8.dp),
            )
            .background(
                if (selected) StrataColors.Paper.copy(alpha = 0.14f)
                else if (focused) StrataColors.Paper.copy(alpha = 0.06f)
                else Color.Transparent,
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(
            text = label,
            color = if (selected || focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.6f),
            style = StrataText.Chip,
        )
    }
}
