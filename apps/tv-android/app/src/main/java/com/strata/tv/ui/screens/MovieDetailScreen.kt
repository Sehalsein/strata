package com.strata.tv.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.CastShelf
import com.strata.tv.ui.components.ChapterRail
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.PrimaryButton
import com.strata.tv.ui.components.SecondaryButton
import com.strata.tv.ui.components.SimilarShelf
import com.strata.tv.ui.components.loadable
import kotlinx.coroutines.launch
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.layout.ContentScale
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.StrataType
import com.strata.tv.ui.theme.opusFor
import com.strata.tv.ui.theme.paletteFor
import org.jellyfin.sdk.model.api.BaseItemDto
import java.util.UUID

@Composable
fun MovieDetailScreen(nav: NavController, id: String) {
    val itemId = UUID.fromString(id)
    val data by loadable(id) {
        val item = ServiceLocator.repository.getItem(itemId)
        val similar = ServiceLocator.repository.getSimilarItems(itemId)
        DetailBundle(item, similar)
    }
    when (val l = data) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> DetailContent(nav, l.value)
    }
}

private data class DetailBundle(val item: BaseItemDto, val similar: List<BaseItemDto>)

@Composable
private fun DetailContent(nav: NavController, bundle: DetailBundle) {
    val item = bundle.item
    val palette = paletteFor(item.id.toString())
    val opus = opusFor(item.id.toString())
    val repo = ServiceLocator.repository
    val beginFocus = remember { FocusRequester() }
    var isFavorite by remember(item.id) {
        mutableStateOf(item.userData?.isFavorite ?: false)
    }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { runCatching { beginFocus.requestFocus() } }

    CompositionLocalProvider(LocalStrataPalette provides palette) {
        TvLazyColumn(
            // High pivot pins the tall hero to the top (its bottom-anchored
            // buttons rest above this line, so no upward scroll clips the title
            // under the floating app bar). Matches the Home standard.
            pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.5f),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 100.dp),
            verticalArrangement = Arrangement.spacedBy(36.dp),
        ) {
            item(key = "hero") {
                Hero(
                    item = item,
                    opus = opus,
                    isFavorite = isFavorite,
                    onPlay = { nav.navigate(Routes.watch(item.id.toString())) },
                    onBack = { nav.popBackStack() },
                    onToggleFavorite = {
                        val next = !isFavorite
                        isFavorite = next
                        scope.launch {
                            runCatching { repo.setFavorite(item.id, next) }
                                .onFailure { isFavorite = !next }
                        }
                    },
                    beginFocus = beginFocus,
                )
            }
            if (!item.genres.isNullOrEmpty()) {
                item(key = "genres") {
                    GenreChips(
                        genres = item.genres.orEmpty(),
                        onSelect = { nav.navigate(Routes.genre(it)) },
                    )
                }
            }
            if (!item.people.isNullOrEmpty()) {
                item(key = "cast") {
                    CastShelf(people = item.people.orEmpty())
                }
            }
            if (!item.chapters.isNullOrEmpty()) {
                item(key = "chapters") {
                    ChapterRail(
                        itemId = item.id,
                        chapters = item.chapters.orEmpty(),
                        onSelect = {
                            // Jellyfin's start-position handoff happens via the
                            // /Items/{id}/PlaybackInfo endpoint and the watch
                            // route's resume position. Jump-to-chapter is a
                            // proper player command (see player chrome), but the
                            // detail surface still navigates to play from start.
                            nav.navigate(Routes.watch(item.id.toString()))
                        },
                    )
                }
            }
            if (bundle.similar.isNotEmpty()) {
                item(key = "similar") {
                    SimilarShelf(
                        items = bundle.similar,
                        onSelect = { sim ->
                            nav.navigate(Routes.movieDetail(sim.id.toString())) {
                                launchSingleTop = true
                            }
                        },
                    )
                }
            }
        }
    }
}

/**
 * Backdrop hero matching the previous full-bleed layout. Refactored into its
 * own composable so the LazyColumn can pin it as the first item while shelves
 * scroll beneath.
 */
@Composable
private fun Hero(
    item: BaseItemDto,
    opus: String,
    isFavorite: Boolean,
    onPlay: () -> Unit,
    onBack: () -> Unit,
    onToggleFavorite: () -> Unit,
    beginFocus: FocusRequester,
) {
    val repo = ServiceLocator.repository
    // Tall hero so the bottom-anchored title/overview/buttons stack sits low
    // enough to clear the floating app bar at the top. Matches the Home cover.
    val heroHeight = (androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp * 0.68f).dp
    Box(modifier = Modifier.fillMaxWidth().height(heroHeight)) {
            AsyncImage(
                model = repo.imageUrls.backdrop(item.id),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alignment = BiasAlignment(0.4f, 0f),
                modifier = Modifier.fillMaxSize(),
            )
            // Gradient masks: left-to-right ink wash + bottom fade
            Box(
                modifier = Modifier.fillMaxSize().background(
                    Brush.horizontalGradient(
                        0f to StrataColors.Bg.copy(alpha = 0.95f),
                        0.35f to StrataColors.Bg.copy(alpha = 0.75f),
                        0.7f to StrataColors.Bg.copy(alpha = 0.2f),
                        1f to Color.Transparent,
                    ),
                ),
            )
            Box(
                modifier = Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0.55f to Color.Transparent,
                        1f to StrataColors.Bg,
                    ),
                ),
            )

            // Left-bottom: title + meta + overview + buttons
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .widthIn(max = 1000.dp)
                    .padding(start = 56.dp, bottom = 44.dp, end = 40.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = item.name.orEmpty(),
                    color = StrataColors.Paper,
                    maxLines = 2,
                    style = StrataText.DetailTitle,
                )
                item.taglines?.firstOrNull()?.let {
                    Text(text = it, color = StrataColors.Accent2, style = StrataText.Tagline)
                }
                MetaRow(item)
                item.overview?.let {
                    Text(
                        text = it,
                        color = StrataColors.Paper.copy(alpha = 0.8f),
                        style = StrataText.Overview,
                        maxLines = 2,
                    )
                }
                val resume = (item.userData?.playbackPositionTicks ?: 0L) > 0L
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    PrimaryButton(
                        label = if (resume) "Resume" else "Play",
                        modifier = Modifier.focusRequester(beginFocus),
                        onClick = onPlay,
                    )
                    SecondaryButton(label = "Back", onClick = onBack)
                    SecondaryButton(
                        label = if (isFavorite) "Watchlisted" else "Watchlist",
                        leadingGlyph = if (isFavorite) "★" else "☆",
                        accent = isFavorite,
                        onClick = onToggleFavorite,
                    )
                }
            }
        }
}

@Composable
private fun MetaRow(item: BaseItemDto) {
    val pieces = buildList {
        item.productionYear?.let { add(it.toString()) }
        item.runTimeTicks?.let {
            val mins = it / 600_000_000L
            val h = mins / 60
            val m = mins % 60
            add(if (h > 0) "${h}h ${m}m" else "${m}m")
        }
        item.officialRating?.let { if (it.isNotBlank()) add(it) }
    }
    Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        pieces.forEachIndexed { i, piece ->
            if (i > 0) Dot()
            Text(text = piece, color = StrataColors.Paper.copy(alpha = 0.85f), style = StrataText.Meta)
        }
        item.communityRating?.let {
            if (pieces.isNotEmpty()) Dot()
            Text(text = "★ ${(it * 10).toInt()}", color = StrataColors.Accent2, style = StrataText.Meta)
        }
    }
}

@Composable
private fun GenreChips(genres: List<String>, onSelect: (String) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 56.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        genres.take(6).forEach { g ->
            GenreChip(label = g, onClick = { onSelect(g) })
        }
    }
}

@Composable
private fun GenreChip(label: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.05f else 1f, label = "genre-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(RoundedCornerShape(8.dp))
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.35f),
                shape = RoundedCornerShape(8.dp),
            )
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.10f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
    ) {
        Text(
            text = label,
            color = StrataColors.Paper.copy(alpha = if (focused) 1f else 0.8f),
            style = StrataText.Chip,
        )
    }
}

@Composable
private fun Dot() {
    Text(text = "·", color = StrataColors.Paper.copy(alpha = 0.4f), style = StrataText.Meta)
}
