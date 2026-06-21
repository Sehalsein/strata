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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.tv.foundation.PivotOffsets
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.foundation.lazy.list.TvLazyRow
import androidx.tv.foundation.lazy.list.items
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.PosterRow
import com.strata.tv.ui.components.PrimaryButton
import com.strata.tv.ui.components.RowStyle
import com.strata.tv.ui.components.SecondaryButton
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.paletteFor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind

@Composable
fun HomeScreen(nav: NavController) {
    val data by loadable(Unit) {
        val repo = ServiceLocator.repository
        coroutineScope {
            // Continue Watching + Next Up fan out in parallel with the per-library
            // latest rows so the home doesn't stall on the slowest single call.
            val cw = async { repo.continueWatching() }
            val nu = async { repo.nextUp() }
            val views = repo.libraryViews()
            val latest = views.map { v -> v to async { repo.latestInLibrary(v.id) } }
            HomeData(
                continueWatching = cw.await(),
                nextUp = nu.await(),
                views = views,
                latest = latest.map { (v, d) -> LibraryRow(v, d.await()) },
            )
        }
    }
    when (val l = data) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> HomeContent(nav, l.value)
    }
}

private data class HomeData(
    val continueWatching: List<BaseItemDto>,
    val nextUp: List<BaseItemDto>,
    val views: List<BaseItemDto>,
    val latest: List<LibraryRow>,
)

private data class LibraryRow(val view: BaseItemDto, val items: List<BaseItemDto>)

@Composable
private fun HomeContent(nav: NavController, data: HomeData) {
    val featured = data.continueWatching.firstOrNull()
        ?: data.latest.firstOrNull { it.items.isNotEmpty() }?.items?.firstOrNull()
        ?: data.nextUp.firstOrNull()
    val firstFocus = remember { FocusRequester() }

    LaunchedEffect(featured) {
        if (featured != null) runCatching { firstFocus.requestFocus() }
    }

    TvLazyColumn(
        // Pivot 0.7 sits just below the hero's button row (the hero is 0.82 tall,
        // buttons at ~0.72), so focusing Play on load/navigation does NOT scroll
        // the cover off — yet it's high enough that the LAST shelf's titles still
        // clear the bottom edge (a higher pivot pinned focused rows so low their
        // labels were clipped).
        pivotOffsets = PivotOffsets(parentFraction = 0.7f),
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        contentPadding = PaddingValues(top = 0.dp, bottom = 120.dp),
    ) {
        if (featured != null) {
            val resumeSeconds = (featured.userData?.playbackPositionTicks ?: 0L) / 10_000_000.0
            item(key = "hero") {
                Hero(
                    item = featured,
                    onPlay = { nav.navigate(Routes.watch(featured.id.toString())) },
                    onMoreInfo = { navigateTo(nav, featured) },
                    beginFocus = firstFocus,
                    hasResume = resumeSeconds > 0,
                )
            }
        }
        if (data.continueWatching.isNotEmpty()) {
            item(key = "label-continue") { SectionLabel("Continue Watching") }
            item(key = "row-continue") {
                // Scene stills (the frame you stopped on) + a resume progress bar.
                PosterRow(
                    items = data.continueWatching,
                    style = RowStyle.SCENE,
                    onSelect = { navigateTo(nav, it) },
                )
            }
        }
        if (data.nextUp.isNotEmpty()) {
            item(key = "label-nextup") { SectionLabel("Next Up") }
            item(key = "row-nextup") {
                // Wide series key art ("wide poster"), not a random frame.
                PosterRow(
                    items = data.nextUp,
                    style = RowStyle.WIDE,
                    onSelect = { navigateTo(nav, it) },
                )
            }
        }
        // One "Latest in <library>" row per movie/show view, in the order the
        // server returns the views. Empty libraries are skipped.
        data.latest.forEach { row ->
            if (row.items.isNotEmpty()) {
                val name = row.view.name.orEmpty()
                item(key = "label-latest-${row.view.id}") { SectionLabel("Latest in $name") }
                item(key = "row-latest-${row.view.id}") {
                    PosterRow(items = row.items, onSelect = { navigateTo(nav, it) })
                }
            }
        }
        if (data.views.isNotEmpty()) {
            item(key = "label-mymedia") { SectionLabel("My Media") }
            item(key = "row-mymedia") {
                LibraryTilesRow(
                    views = data.views,
                    onSelect = { nav.navigate(Routes.library(it.id.toString())) },
                )
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        color = StrataColors.Paper,
        style = StrataText.SectionTitle,
        modifier = Modifier.padding(horizontal = 48.dp, vertical = 2.dp),
    )
}

/** A row of wide library tiles — the "My Media" shelf that opens a browse grid. */
@Composable
private fun LibraryTilesRow(views: List<BaseItemDto>, onSelect: (BaseItemDto) -> Unit) {
    TvLazyRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        contentPadding = PaddingValues(start = 44.dp, end = 44.dp, top = 12.dp, bottom = 16.dp),
    ) {
        items(views, key = { it.id.toString() }) { view ->
            LibraryTile(view = view, onClick = { onSelect(view) })
        }
    }
}

@Composable
private fun LibraryTile(view: BaseItemDto, onClick: () -> Unit) {
    val repo = ServiceLocator.repository
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "tile-scale")
    val interaction = remember { MutableInteractionSource() }
    Column(modifier = Modifier.width(248.dp)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .scale(scale)
                .border(
                    width = if (focused) 3.dp else 1.dp,
                    color = if (focused) StrataColors.Accent2 else StrataColors.Paper.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(10.dp),
                )
                .padding(if (focused) 4.dp else 1.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(StrataColors.Bg2)
                .onFocusChanged { focused = it.isFocused }
                .clickable(interactionSource = interaction, indication = null, onClick = onClick),
        ) {
            AsyncImage(
                model = repo.imageUrls.image(view.id, maxWidth = 600),
                contentDescription = view.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.45f to Color.Transparent,
                            1f to StrataColors.Bg.copy(alpha = 0.85f),
                        ),
                    ),
            )
            Text(
                text = view.name.orEmpty(),
                color = StrataColors.Paper,
                style = StrataText.CardTitle,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            )
        }
    }
}

@Composable
private fun Hero(
    item: BaseItemDto,
    onPlay: () -> Unit,
    onMoreInfo: () -> Unit,
    beginFocus: FocusRequester,
    hasResume: Boolean = false,
) {
    val palette = paletteFor(item.id.toString())
    val repo = ServiceLocator.repository
    // Near full-screen billboard like Netflix's home cover: the backdrop fills
    // ~90% of the screen so a 16:9 still is barely cropped (a shorter box crops
    // the top/bottom hard — ~28% at 0.72), and the first shelf only peeks in at
    // the bottom, inviting a scroll. Scales with the TV.
    val heroHeight = (LocalConfiguration.current.screenHeightDp * 0.9f).dp

    CompositionLocalProvider(LocalStrataPalette provides palette) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(heroHeight),
        ) {
            AsyncImage(
                // Episodes carry no backdrop of their own — fall back to the
                // series' backdrop so the cover isn't blank for a Continue
                // Watching / Next Up episode.
                model = repo.imageUrls.backdrop(item.seriesId ?: item.id),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alignment = BiasAlignment(0.4f, 0f),
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.horizontalGradient(
                            0f to StrataColors.Bg.copy(alpha = 0.96f),
                            0.32f to StrataColors.Bg.copy(alpha = 0.82f),
                            0.6f to StrataColors.Bg.copy(alpha = 0.35f),
                            1f to Color.Transparent,
                        ),
                    ),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.65f to Color.Transparent,
                            1f to StrataColors.Bg,
                        ),
                    ),
            )

            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .widthIn(max = 900.dp)
                    // start matches the row contentPadding so the hero title and
                    // the posters below share a left margin; extra bottom keeps
                    // the buttons clear of TV overscan.
                    .padding(start = 48.dp, bottom = 40.dp, end = 40.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // For an episode, the series name is the cover title and the
                // episode name rides above the meta row.
                Text(
                    text = item.seriesName ?: item.name.orEmpty(),
                    color = StrataColors.Paper,
                    maxLines = 2,
                    style = StrataText.HeroTitle,
                )
                item.seriesName?.let {
                    Text(
                        text = item.name.orEmpty(),
                        color = StrataColors.Accent2,
                        style = StrataText.Tagline,
                    )
                }
                MetaRow(item)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    PrimaryButton(
                        label = if (hasResume) "Resume" else "Play",
                        modifier = Modifier.focusRequester(beginFocus),
                        onClick = onPlay,
                    )
                    SecondaryButton(label = "More Info", leadingGlyph = "ⓘ", onClick = onMoreInfo)
                }
            }
        }
    }
}

@Composable
private fun MetaRow(item: BaseItemDto) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        item.productionYear?.let {
            Text(text = it.toString(), color = StrataColors.Paper.copy(alpha = 0.85f), style = StrataText.Meta)
            Dot()
        }
        item.runTimeTicks?.let {
            val mins = it / 600_000_000L
            val h = mins / 60
            val m = mins % 60
            Text(
                text = if (h > 0) "${h}h ${m}m" else "${m}m",
                color = StrataColors.Paper.copy(alpha = 0.85f),
                style = StrataText.Meta,
            )
        }
        item.communityRating?.let {
            Dot()
            Text(
                text = "★ ${(it * 10).toInt()}",
                color = StrataColors.Accent2,
                style = StrataText.Meta,
            )
        }
    }
}

@Composable
private fun Dot() {
    Text(text = "·", color = StrataColors.Paper.copy(alpha = 0.4f), style = StrataText.Meta)
}

internal fun navigateTo(nav: NavController, item: BaseItemDto) {
    val id = item.id.toString()
    when (item.type) {
        BaseItemKind.MOVIE -> nav.navigate(Routes.movieDetail(id))
        BaseItemKind.SERIES -> nav.navigate(Routes.showDetail(id))
        BaseItemKind.EPISODE -> nav.navigate(Routes.watch(id))
        else -> nav.navigate(Routes.watch(id))
    }
}
