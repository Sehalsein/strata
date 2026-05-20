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
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.SeasonsBrowser
import com.strata.tv.ui.components.SimilarShelf
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
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
            pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.15f),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 48.dp),
            verticalArrangement = Arrangement.spacedBy(48.dp),
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
                )
            }
            if (!bundle.series.people.isNullOrEmpty()) {
                item(key = "cast") {
                    CastShelf(people = bundle.series.people.orEmpty())
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
) {
    val repo = ServiceLocator.repository
    Box(modifier = Modifier.fillMaxWidth().height(680.dp)) {
        AsyncImage(
            model = repo.imageUrls.backdrop(series.id),
            contentDescription = null,
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
            horizontalAlignment = Alignment.End,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(end = 48.dp, top = 24.dp),
        ) {
            MonoStrip("In Repertory", alpha = 0.65f)
            Spacer(Modifier.height(6.dp))
            MonoStrip("Opus № $opus", alpha = 0.45f)
            Spacer(Modifier.height(16.dp))
            Box(
                Modifier
                    .width(40.dp)
                    .height(1.dp)
                    .background(StrataColors.Paper.copy(alpha = 0.3f)),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "presented in",
                color = StrataColors.Paper.copy(alpha = 0.55f),
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontStyle = FontStyle.Italic,
                    fontSize = 14.sp,
                ),
            )
            Spacer(Modifier.height(4.dp))
            MonoStrip(
                "${series.childCount ?: 0} Seasons",
                alpha = 0.75f,
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .widthIn(max = 920.dp)
                .padding(start = 48.dp, bottom = 28.dp, end = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .width(36.dp)
                        .height(1.dp)
                        .background(StrataColors.Accent),
                )
                Spacer(Modifier.width(16.dp))
                MonoStrip("A Continuing Programme", alpha = 0.85f, tracking = 3.2.sp)
                Spacer(Modifier.width(12.dp))
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(StrataColors.Accent),
                )
            }
            Text(
                text = series.name.orEmpty(),
                color = StrataColors.Paper,
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontSize = 72.sp,
                    fontWeight = FontWeight.Medium,
                    lineHeight = 70.sp,
                    letterSpacing = (-2.5).sp,
                ),
            )
            series.taglines?.firstOrNull()?.let {
                Text(
                    text = it,
                    color = StrataColors.Accent2,
                    style = TextStyle(
                        fontFamily = StrataType.Fraunces,
                        fontStyle = FontStyle.Italic,
                        fontSize = 20.sp,
                    ),
                )
            }
            MetaRow(series)
            series.overview?.let {
                Text(
                    text = it,
                    color = StrataColors.Paper.copy(alpha = 0.78f),
                    style = TextStyle(
                        fontFamily = StrataType.Fraunces,
                        fontSize = 15.sp,
                        lineHeight = 22.sp,
                    ),
                    maxLines = 3,
                )
            }
            Spacer(Modifier.height(4.dp))
            val resume = (series.userData?.playbackPositionTicks ?: 0L) > 0L
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                SolidActionButton(
                    label = if (resume) "RESUME" else "BEGIN",
                    modifier = Modifier.focusRequester(beginFocus),
                    onClick = onPlay,
                )
                GhostActionButton(label = "BACK", onClick = onBack)
                WatchlistButton(isFavorite = isFavorite, onToggle = onToggleFavorite)
                Spacer(Modifier.width(8.dp))
                MonoStrip(if (resume) "Press OK to resume" else "Press OK to begin", alpha = 0.4f)
            }
        }
    }
}

@Composable
private fun MetaRow(series: BaseItemDto) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        series.productionYear?.let { MonoStrip("Anno $it", alpha = 0.7f); Dot() }
        series.childCount?.let { MonoStrip("${it} Seasons", alpha = 0.7f); Dot() }
        series.officialRating?.let { MonoStrip(it, alpha = 0.7f); Dot() }
        Text(
            text = "a continuing series",
            color = StrataColors.Paper.copy(alpha = 0.85f),
            style = TextStyle(
                fontFamily = StrataType.Fraunces,
                fontStyle = FontStyle.Italic,
                fontSize = 14.sp,
            ),
        )
        series.communityRating?.let {
            Dot()
            val score = (it * 10).toInt()
            Text(
                text = "★ $score/100",
                color = StrataColors.Accent2,
                style = TextStyle(
                    fontFamily = StrataType.Mono,
                    fontSize = 11.sp,
                    letterSpacing = 2.sp,
                ),
            )
        }
    }
}

@Composable
private fun Dot() {
    Text(
        text = "·",
        color = StrataColors.Paper.copy(alpha = 0.3f),
        style = TextStyle(fontFamily = StrataType.Mono, fontSize = 11.sp),
    )
}

@Composable
private fun MonoStrip(
    text: String,
    alpha: Float = 0.6f,
    tracking: androidx.compose.ui.unit.TextUnit = 2.sp,
) {
    Text(
        text = text.uppercase(),
        color = StrataColors.Paper.copy(alpha = alpha),
        style = TextStyle(
            fontFamily = StrataType.Mono,
            fontSize = 11.sp,
            letterSpacing = tracking,
        ),
    )
}

@Composable
private fun SolidActionButton(
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "begin-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .scale(scale)
            .clip(RoundedCornerShape(4.dp))
            .background(if (focused) Color.White else StrataColors.Paper)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 26.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "▶",
                color = StrataColors.Ink,
                style = TextStyle(fontSize = 14.sp),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = label,
                color = StrataColors.Ink,
                style = TextStyle(
                    fontFamily = StrataType.Mono,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 3.sp,
                ),
            )
        }
    }
}

@Composable
private fun GhostActionButton(label: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "ghost-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(RoundedCornerShape(4.dp))
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.4f),
                shape = RoundedCornerShape(4.dp),
            )
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.08f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 26.dp, vertical = 14.dp),
    ) {
        Text(
            text = label,
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
            ),
        )
    }
}

@Composable
private fun WatchlistButton(isFavorite: Boolean, onToggle: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "fav-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(RoundedCornerShape(4.dp))
            .border(
                width = 1.dp,
                color = when {
                    focused -> StrataColors.Paper
                    isFavorite -> StrataColors.Accent2
                    else -> StrataColors.Paper.copy(alpha = 0.4f)
                },
                shape = RoundedCornerShape(4.dp),
            )
            .background(
                when {
                    isFavorite -> StrataColors.Accent2.copy(alpha = 0.12f)
                    focused -> StrataColors.Paper.copy(alpha = 0.08f)
                    else -> Color.Transparent
                },
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onToggle)
            .padding(horizontal = 22.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = if (isFavorite) "★" else "☆",
                color = if (isFavorite) StrataColors.Accent2 else StrataColors.Paper,
                style = TextStyle(fontSize = 14.sp),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = if (isFavorite) "WATCHLISTED" else "WATCHLIST",
                color = if (isFavorite) StrataColors.Accent2 else StrataColors.Paper,
                style = TextStyle(
                    fontFamily = StrataType.Mono,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 3.sp,
                ),
            )
        }
    }
}
