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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.PosterRow
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataType
import com.strata.tv.ui.theme.opusFor
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
    // Matches Apple's `HomeView.swift:112`: resume → recent movie → recent show.
    // A returning user lands on what they were watching, not a random new title.
    val featured = data.continueWatching.firstOrNull()
        ?: data.movies.firstOrNull()
        ?: data.shows.firstOrNull()
    val firstFocus = remember { FocusRequester() }
    val session by ServiceLocator.authStore.session.collectAsState()

    LaunchedEffect(featured) {
        if (featured != null) runCatching { firstFocus.requestFocus() }
    }

    // Hero is pinned above the lazy column so it never scrolls out of view
    // when focus moves to BEGIN. Below it, the rows scroll on Down.
    Column(modifier = Modifier.fillMaxSize()) {
        if (featured != null) {
            val resumeSeconds = (featured.userData?.playbackPositionTicks ?: 0L) / 10_000_000.0
            Hero(
                item = featured,
                totalFilms = data.movies.size,
                totalShows = data.shows.size,
                onBegin = { nav.navigate(Routes.watch(featured.id.toString())) },
                onProgramme = { navigateTo(nav, featured) },
                beginFocus = firstFocus,
                hasResume = resumeSeconds > 0,
            )
        }
        TvLazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(36.dp),
            contentPadding = PaddingValues(top = 24.dp, bottom = 48.dp),
        ) {
            if (data.continueWatching.isNotEmpty()) {
                item { SectionLabel("Continue watching", num = "↻ 01") }
                item { PadRow { PosterRow(items = data.continueWatching, onSelect = { navigateTo(nav, it) }) } }
            }
            item { SectionLabel("Recent films", num = "▸ 02") }
            item { PadRow { PosterRow(items = data.movies, onSelect = { navigateTo(nav, it) }) } }
            item { SectionLabel("Recent series", num = "▸ 03") }
            item { PadRow { PosterRow(items = data.shows, onSelect = { navigateTo(nav, it) }) } }
            session?.let { s ->
                item { AccountSection(name = s.userName) }
            }
        }
    }
}

@Composable
private fun AccountSection(name: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 48.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(StrataColors.Paper.copy(alpha = 0.08f)),
        )
        Spacer(Modifier.height(16.dp))
        Text(
            text = "ACCOUNT",
            color = StrataColors.Paper.copy(alpha = 0.55f),
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 11.sp,
                letterSpacing = 3.2.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(
                text = "Signed in as ${name.ifBlank { "guest" }}",
                color = StrataColors.Paper,
                style = TextStyle(
                    fontFamily = StrataType.Plex,
                    fontSize = 20.sp,
                ),
            )
            Spacer(Modifier.weight(1f))
            SignOutButton(
                onClick = {
                    ServiceLocator.repository.signOut()
                },
            )
        }
    }
}

@Composable
private fun SignOutButton(onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "signout-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.4f),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(4.dp),
            )
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.08f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 12.dp),
    ) {
        Text(
            text = "SIGN OUT",
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
            ),
        )
    }
}

@Composable
private fun PadRow(content: @Composable () -> Unit) {
    Box(modifier = Modifier.padding(horizontal = 48.dp)) { content() }
}

@Composable
private fun SectionLabel(text: String, num: String) {
    Row(
        modifier = Modifier.padding(horizontal = 48.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = num,
            color = StrataColors.Paper.copy(alpha = 0.4f),
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 11.sp,
                letterSpacing = 2.sp,
            ),
        )
        Spacer(Modifier.width(14.dp))
        Text(
            text = text,
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = StrataType.Fraunces,
                fontSize = 26.sp,
                fontStyle = FontStyle.Italic,
                fontWeight = FontWeight.Medium,
                letterSpacing = (-0.4).sp,
            ),
        )
    }
}

@Composable
private fun Hero(
    item: BaseItemDto,
    totalFilms: Int,
    totalShows: Int,
    onBegin: () -> Unit,
    onProgramme: () -> Unit,
    beginFocus: FocusRequester,
    hasResume: Boolean = false,
) {
    val palette = paletteFor(item.id.toString())
    val opus = opusFor(item.id.toString())
    val repo = ServiceLocator.repository

    CompositionLocalProvider(LocalStrataPalette provides palette) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(640.dp),
            ) {
                // Backdrop image: crop & bias subject to the right
                // (matches web's `object-position: 65% center`).
                AsyncImage(
                    model = repo.imageUrls.backdrop(item.id),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    alignment = androidx.compose.ui.BiasAlignment(0.4f, 0f),
                    modifier = Modifier.fillMaxSize(),
                )
                // Cinematic gradient masks — strong left ink wash + bottom fade
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

                // Right-side: Feature Presentation rail
                Column(
                    horizontalAlignment = Alignment.End,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(end = 48.dp, top = 24.dp),
                ) {
                    MonoText("Feature Presentation", alpha = 0.7f)
                    Spacer(Modifier.height(6.dp))
                    Row {
                        MonoText("Vol. II", alpha = 0.45f)
                        MonoText("  ·  ", alpha = 0.25f)
                        MonoText("Opus № $opus", alpha = 0.45f)
                    }
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
                            fontSize = 14.sp,
                            fontStyle = FontStyle.Italic,
                        ),
                    )
                    Spacer(Modifier.height(4.dp))
                    MonoText("4K · HDR · Atmos", alpha = 0.75f)
                }

                // Left-bottom: title + metadata + buttons
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .widthIn(max = 1100.dp)
                        .padding(start = 48.dp, bottom = 32.dp, end = 32.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .width(36.dp)
                                .height(1.dp)
                                .background(StrataColors.Accent),
                        )
                        Spacer(Modifier.width(16.dp))
                        MonoText("Tonight in Repertory", alpha = 0.85f, tracking = 3.2.sp)
                        Spacer(Modifier.width(12.dp))
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(StrataColors.Accent),
                        )
                    }
                    Text(
                        text = item.name.orEmpty(),
                        color = StrataColors.Paper,
                        maxLines = 2,
                        style = TextStyle(
                            fontFamily = StrataType.Fraunces,
                            fontSize = 84.sp,
                            fontWeight = FontWeight.Medium,
                            lineHeight = 80.sp,
                            letterSpacing = (-3).sp,
                        ),
                    )
                    MetaRow(item)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        BeginButton(
                            modifier = Modifier.focusRequester(beginFocus),
                            label = if (hasResume) "RESUME" else "BEGIN",
                            onClick = onBegin,
                        )
                        ProgrammeButton(onClick = onProgramme)
                        Spacer(Modifier.width(8.dp))
                        MonoText(
                            if (hasResume) "Press OK to resume" else "Press OK to begin",
                            alpha = 0.4f,
                        )
                    }
                }
            }

            // Catalog spec strip — separate row below the hero, never overlaps
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(StrataColors.Paper.copy(alpha = 0.08f)),
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 48.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MonoText("In Your Catalog", alpha = 0.4f)
                Spacer(Modifier.width(12.dp))
                MonoText("/", alpha = 0.3f)
                Spacer(Modifier.width(12.dp))
                MonoText("${totalFilms.toString().padStart(3, '0')} Films", alpha = 0.85f)
                Spacer(Modifier.width(12.dp))
                MonoText("·", alpha = 0.3f)
                Spacer(Modifier.width(12.dp))
                MonoText("${totalShows.toString().padStart(3, '0')} Series", alpha = 0.85f)
                Spacer(Modifier.weight(1f))
                MonoText("Scroll down for the index ↓", alpha = 0.4f)
            }
        }
    }
}

@Composable
private fun MetaRow(item: BaseItemDto) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        item.productionYear?.let {
            MonoText("Anno $it", alpha = 0.7f)
            Dot()
        }
        item.runTimeTicks?.let {
            val mins = it / 600_000_000L
            val h = mins / 60
            val m = mins % 60
            MonoText(if (h > 0) "${h}H ${m}M" else "${m}M", alpha = 0.7f)
            Dot()
        }
        Text(
            text = "a motion picture",
            color = StrataColors.Paper.copy(alpha = 0.85f),
            style = TextStyle(
                fontFamily = StrataType.Fraunces,
                fontStyle = FontStyle.Italic,
                fontSize = 14.sp,
            ),
        )
        item.communityRating?.let {
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
private fun MonoText(
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
private fun BeginButton(modifier: Modifier = Modifier, label: String = "BEGIN", onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "begin-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .scale(scale)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
            .background(if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.95f))
            .onFocusChanged { focused = it.isFocused }
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            )
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
private fun ProgrammeButton(onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "programme-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.4f),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(4.dp),
            )
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.08f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 26.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "ⓘ",
                color = StrataColors.Paper,
                style = TextStyle(fontSize = 14.sp),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = "PROGRAMME",
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
