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
import androidx.compose.ui.focus.focusProperties
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
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.layout.ContentScale
import com.strata.tv.ui.components.CastShelf
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.PrimaryButton
import com.strata.tv.ui.components.SeasonsBrowser
import com.strata.tv.ui.components.SecondaryButton
import com.strata.tv.ui.components.SimilarShelf
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.StrataType
import com.strata.tv.ui.theme.opusFor
import com.strata.tv.ui.theme.paletteFor
import kotlinx.coroutines.launch
import org.jellyfin.sdk.model.api.BaseItemDto
import java.util.UUID

@Composable
fun ShowDetailScreen(nav: NavController, id: String) {
    val seriesId = UUID.fromString(id)
    val repo = ServiceLocator.repository
    val bundle by loadable(id) {
        ShowBundle(
            series = repo.getItem(seriesId),
            seasons = repo.getSeasons(seriesId),
            similar = repo.getSimilarItems(seriesId),
        )
    }
    when (val l = bundle) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> ShowContent(nav, l.value)
    }
}

private data class ShowBundle(
    val series: BaseItemDto,
    val seasons: List<BaseItemDto>,
    val similar: List<BaseItemDto>,
)

@Composable
private fun ShowContent(nav: NavController, bundle: ShowBundle) {
    val palette = paletteFor(bundle.series.id.toString())
    val opus = opusFor(bundle.series.id.toString())
    val repo = ServiceLocator.repository
    val beginFocus = remember { FocusRequester() }
    val castFocus = remember { FocusRequester() }
    val hasCast = !bundle.series.people.isNullOrEmpty()
    val scope = rememberCoroutineScope()
    var selectedSeason by remember(bundle.series.id) {
        mutableStateOf(bundle.seasons.firstOrNull())
    }
    var isFavorite by remember(bundle.series.id) {
        mutableStateOf(bundle.series.userData?.isFavorite ?: false)
    }
    val episodes by loadable(bundle.series.id, selectedSeason?.id) {
        selectedSeason?.let { repo.getEpisodes(bundle.series.id, it.id) } ?: emptyList()
    }

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
                    series = bundle.series,
                    opus = opus,
                    isFavorite = isFavorite,
                    onPlay = {
                        val target = pickFirstWatchTarget(bundle.series)
                            ?: bundle.series.id
                        nav.navigate(Routes.watch(target.toString()))
                    },
                    onBack = { nav.popBackStack() },
                    onToggleFavorite = {
                        val next = !isFavorite
                        isFavorite = next
                        scope.launch {
                            runCatching { repo.setFavorite(bundle.series.id, next) }
                                .onFailure { isFavorite = !next }
                        }
                    },
                    beginFocus = beginFocus,
                    downTarget = if (hasCast) castFocus else null,
                )
            }
            if (hasCast) {
                item(key = "cast") {
                    CastShelf(
                        people = bundle.series.people.orEmpty(),
                        firstFocus = castFocus,
                    )
                }
            }
            item(key = "episodes") {
                val epList = (episodes as? Loadable.Ready)?.value.orEmpty()
                SeasonsBrowser(
                    seasons = bundle.seasons,
                    selectedSeason = selectedSeason,
                    episodes = epList,
                    onSelectSeason = { selectedSeason = it },
                    onSelectEpisode = { ep ->
                        nav.navigate(Routes.watch(ep.id.toString()))
                    },
                )
            }
            if (bundle.similar.isNotEmpty()) {
                item(key = "similar") {
                    SimilarShelf(
                        items = bundle.similar,
                        onSelect = { sim ->
                            nav.navigate(Routes.showDetail(sim.id.toString())) {
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
 * If the series has a continue-watching episode we'd rather resume that than
 * cold-start the pilot. `userData.resumePositionTicks` lives on the series
 * itself when there is in-progress playback; if not, the watch route falls
 * back to the series id and Jellyfin's PlaybackInfo decides what to play.
 */
private fun pickFirstWatchTarget(series: BaseItemDto): UUID? {
    val resume = series.userData?.playbackPositionTicks ?: 0L
    return if (resume > 0L) series.id else null
}

@Composable
private fun Hero(
    series: BaseItemDto,
    opus: String,
    isFavorite: Boolean,
    onPlay: () -> Unit,
    onBack: () -> Unit,
    onToggleFavorite: () -> Unit,
    beginFocus: FocusRequester,
    downTarget: FocusRequester? = null,
) {
    val repo = ServiceLocator.repository
    // Tall hero so the bottom-anchored title/overview/buttons stack sits low
    // enough to clear the floating app bar at the top. Matches the Home cover.
    val heroHeight = (androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp * 0.68f).dp
    Box(modifier = Modifier.fillMaxWidth().height(heroHeight)) {
        AsyncImage(
            model = repo.imageUrls.backdrop(series.id),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            alignment = BiasAlignment(0.4f, 0f),
            modifier = Modifier.fillMaxSize(),
        )
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

        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .widthIn(max = 1000.dp)
                .padding(start = 56.dp, bottom = 44.dp, end = 40.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = series.name.orEmpty(),
                color = StrataColors.Paper,
                maxLines = 2,
                style = StrataText.DetailTitle,
            )
            series.taglines?.firstOrNull()?.let {
                Text(text = it, color = StrataColors.Accent2, style = StrataText.Tagline)
            }
            MetaRow(series)
            series.overview?.let {
                Text(
                    text = it,
                    color = StrataColors.Paper.copy(alpha = 0.8f),
                    style = StrataText.Overview,
                    maxLines = 2,
                )
            }
            val resume = (series.userData?.playbackPositionTicks ?: 0L) > 0L
            // D-pad Down from a hero button drops straight onto the first section
            // below (cast) — the lazy column's focus search otherwise skips the
            // partially-visible rows. Applied per-button (a non-focusable Row
            // doesn't forward focusProperties to its children).
            val downMod = if (downTarget != null) {
                Modifier.focusProperties { down = downTarget }
            } else Modifier
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                PrimaryButton(
                    label = if (resume) "Resume" else "Play",
                    modifier = Modifier.focusRequester(beginFocus).then(downMod),
                    onClick = onPlay,
                )
                SecondaryButton(label = "Back", modifier = downMod, onClick = onBack)
                SecondaryButton(
                    label = if (isFavorite) "Watchlisted" else "Watchlist",
                    leadingGlyph = if (isFavorite) "★" else "☆",
                    accent = isFavorite,
                    modifier = downMod,
                    onClick = onToggleFavorite,
                )
            }
        }
    }
}

@Composable
private fun MetaRow(series: BaseItemDto) {
    val pieces = buildList {
        series.productionYear?.let { add(it.toString()) }
        series.childCount?.let { add(if (it == 1) "1 Season" else "$it Seasons") }
        series.officialRating?.let { if (it.isNotBlank()) add(it) }
    }
    Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        pieces.forEachIndexed { i, piece ->
            if (i > 0) Dot()
            Text(text = piece, color = StrataColors.Paper.copy(alpha = 0.85f), style = StrataText.Meta)
        }
        series.communityRating?.let {
            if (pieces.isNotEmpty()) Dot()
            Text(text = "★ ${(it * 10).toInt()}", color = StrataColors.Accent2, style = StrataText.Meta)
        }
    }
}

@Composable
private fun Dot() {
    Text(text = "·", color = StrataColors.Paper.copy(alpha = 0.4f), style = StrataText.Meta)
}
