package com.strata.tv.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.jellyfin.sdk.model.api.BaseItemDto

/**
 * "More like this" row — wraps `PosterRow` with the editorial section
 * heading so detail screens get a consistent shelf style without each
 * caller re-rolling the label.
 */
@Composable
fun SimilarShelf(
    items: List<BaseItemDto>,
    modifier: Modifier = Modifier,
    title: String = "More like this",
    num: String = "·",
    onSelect: (BaseItemDto) -> Unit,
) {
    if (items.isEmpty()) return
    Column(modifier = modifier) {
        SectionHeading(title = title, num = num)
        Spacer(Modifier.height(16.dp))
        androidx.compose.foundation.layout.Box(
            modifier = Modifier.padding(horizontal = 48.dp),
        ) {
            PosterRow(items = items, onSelect = onSelect)
        }
    }
}
