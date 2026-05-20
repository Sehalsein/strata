package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.TrickplayInfoDto
import java.util.UUID

/**
 * Trickplay thumbnail rendered above the scrubber. Each Jellyfin trickplay
 * tile is a `tileWidth × tileHeight` grid of cells covering `interval` ms
 * each — we work out which tile + cell the position maps to, then size the
 * full tile image so a single cell matches the viewport, and translate to
 * bring the correct cell into view. Outer clip hides everything else.
 *
 * Coil caches each tile by URL so neighbour positions reuse the same
 * bitmap; the only per-frame work is updating the graphicsLayer translation.
 */
private val VIEWPORT_W = 240.dp
private val VIEWPORT_H = 135.dp

@Composable
fun TrickplayThumbnail(
    itemId: UUID,
    info: TrickplayInfoDto,
    positionMs: Long,
    modifier: Modifier = Modifier,
) {
    val interval = info.interval.coerceAtLeast(1)
    val perTile = info.tileWidth * info.tileHeight
    val thumbIndex = (positionMs / interval).toInt().coerceAtLeast(0)
    val tileIndex = thumbIndex / perTile
    val cellWithin = thumbIndex % perTile
    val cellRow = cellWithin / info.tileWidth
    val cellCol = cellWithin % info.tileWidth

    val tileUrl = ServiceLocator.repository.imageUrls.trickplayTile(itemId, info.width, tileIndex)

    Box(
        modifier = modifier
            .size(width = VIEWPORT_W, height = VIEWPORT_H)
            .clip(RoundedCornerShape(4.dp))
            .background(StrataColors.Bg2),
    ) {
        // Tile dimensions: each cell sized to the viewport, scaled
        // horizontally/vertically by the grid count. ContentScale.FillBounds
        // stretches the image to that full scaled size.
        AsyncImage(
            model = tileUrl,
            contentDescription = null,
            contentScale = ContentScale.FillBounds,
            alignment = Alignment.TopStart,
            modifier = Modifier
                .size(
                    width = VIEWPORT_W * info.tileWidth,
                    height = VIEWPORT_H * info.tileHeight,
                )
                .graphicsLayer {
                    transformOrigin = TransformOrigin(0f, 0f)
                    translationX = -(cellCol * size.width / info.tileWidth)
                    translationY = -(cellRow * size.height / info.tileHeight)
                },
        )
    }
}

/** Pick the best trickplay variant by width — Jellyfin commonly ships 320 and 640. */
fun trickplayFor(item: BaseItemDto, mediaSourceId: String?): TrickplayInfoDto? {
    val byMedia = item.trickplay ?: return null
    val variants = mediaSourceId?.let { byMedia[it] }
        ?: byMedia.values.firstOrNull()
        ?: return null
    return variants.values.maxByOrNull { it.width }
}
