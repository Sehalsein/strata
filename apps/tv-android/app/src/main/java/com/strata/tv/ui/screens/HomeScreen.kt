package com.strata.tv.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.PosterRow
import com.strata.tv.ui.components.PrimaryButton
import com.strata.tv.ui.components.SecondaryButton
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.paletteFor
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind

@Composable
fun HomeScreen(nav: NavController) {
    val repo = ServiceLocator.repository
    val data by loadable(Unit) {
        HomeData(
            continueWatching = repo.continueWatching(),
            movies = repo.listMovies().take(20),
            shows = repo.listShows().take(20),
        )
    }
    when (val l = data) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> HomeContent(nav, l.value)
    }
}

private data class HomeData(
    val continueWatching: List<BaseItemDto>,
    val movies: List<BaseItemDto>,
    val shows: List<BaseItemDto>,
)

@Composable
private fun HomeContent(nav: NavController, data: HomeData) {
    val featured = data.continueWatching.firstOrNull()
        ?: data.movies.firstOrNull()
        ?: data.shows.firstOrNull()
    val firstFocus = remember { FocusRequester() }
    val session by ServiceLocator.authStore.session.collectAsState()

    LaunchedEffect(featured) {
        if (featured != null) runCatching { firstFocus.requestFocus() }
    }

    TvLazyColumn(
        // Higher pivot so the focused hero/Play button sits lower in the frame,
        // keeping the hero title above it on screen (a low pivot yanked the
        // title under the top bar). Rows below settle in the eye-line too.
        pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.42f),
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        contentPadding = PaddingValues(top = 0.dp, bottom = 48.dp),
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
                PadRow { PosterRow(items = data.continueWatching, onSelect = { navigateTo(nav, it) }) }
            }
        }
        item(key = "label-films") { SectionLabel("Movies") }
        item(key = "row-films") {
            PadRow { PosterRow(items = data.movies, onSelect = { navigateTo(nav, it) }) }
        }
        item(key = "label-series") { SectionLabel("Shows") }
        item(key = "row-series") {
            PadRow { PosterRow(items = data.shows, onSelect = { navigateTo(nav, it) }) }
        }
        session?.let { s ->
            item(key = "account") { AccountSection(nav = nav, name = s.userName) }
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

@Composable
private fun PadRow(content: @Composable () -> Unit) {
    Box(modifier = Modifier.padding(horizontal = 48.dp)) { content() }
}

@Composable
private fun AccountSection(nav: NavController, name: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 56.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(text = "Account", color = StrataColors.Paper, style = StrataText.SectionTitle)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Signed in as ${name.ifBlank { "guest" }}",
                color = StrataColors.Paper.copy(alpha = 0.85f),
                style = StrataText.Meta,
            )
            Spacer(Modifier.weight(1f))
            SecondaryButton(label = "Switch profile", onClick = { nav.navigate(Routes.Profiles) })
            SecondaryButton(label = "Sign out", onClick = { ServiceLocator.repository.signOut() })
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
    // Hero sized to the screen (scales with the TV). Kept moderate so its
    // backdrop doesn't leave a tall black fade below the content when the list
    // scrolls down to the first shelf.
    val heroHeight = (LocalConfiguration.current.screenHeightDp * 0.62f).dp

    CompositionLocalProvider(LocalStrataPalette provides palette) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(heroHeight),
        ) {
            AsyncImage(
                model = repo.imageUrls.backdrop(item.id),
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
                    .padding(start = 48.dp, bottom = 28.dp, end = 40.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = item.name.orEmpty(),
                    color = StrataColors.Paper,
                    maxLines = 2,
                    style = StrataText.HeroTitle,
                )
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
