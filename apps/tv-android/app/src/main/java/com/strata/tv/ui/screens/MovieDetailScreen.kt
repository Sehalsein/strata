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
import com.strata.tv.ui.components.SimilarShelf
import com.strata.tv.ui.components.loadable
import kotlinx.coroutines.launch
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
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
            pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.15f),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 48.dp),
            verticalArrangement = Arrangement.spacedBy(48.dp),
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
    Box(modifier = Modifier.fillMaxWidth().height(680.dp)) {
            AsyncImage(
                model = repo.imageUrls.backdrop(item.id),
                contentDescription = null,
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

            // Right-side feature presentation rail
            Column(
                horizontalAlignment = Alignment.End,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(end = 48.dp, top = 24.dp),
            ) {
                MonoStrip("Feature Presentation", alpha = 0.65f)
                Spacer(Modifier.height(6.dp))
                Row {
                    MonoStrip("Opus № $opus", alpha = 0.45f)
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
                        fontStyle = FontStyle.Italic,
                        fontSize = 14.sp,
                    ),
                )
                Spacer(Modifier.height(4.dp))
                MonoStrip("4K · HDR · Atmos", alpha = 0.75f)
            }

            // Left-bottom: title + meta + buttons (pinned bottom, scales with content)
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
                    MonoStrip("Now Showing", alpha = 0.85f, tracking = 3.2.sp)
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
                    style = TextStyle(
                        fontFamily = StrataType.Fraunces,
                        fontSize = 72.sp,
                        fontWeight = FontWeight.Medium,
                        lineHeight = 70.sp,
                        letterSpacing = (-2.5).sp,
                    ),
                )
                item.taglines?.firstOrNull()?.let {
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
                MetaRow(item)
                item.overview?.let {
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
                val resume = (item.userData?.playbackPositionTicks ?: 0L) > 0L
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    SolidActionButton(
                        label = if (resume) "RESUME" else "BEGIN",
                        modifier = Modifier.focusRequester(beginFocus),
                        onClick = onPlay,
                    )
                    GhostActionButton(
                        label = "BACK",
                        onClick = onBack,
                    )
                    WatchlistButton(isFavorite = isFavorite, onToggle = onToggleFavorite)
                    Spacer(Modifier.width(8.dp))
                    MonoStrip(if (resume) "Press OK to resume" else "Press OK to begin", alpha = 0.4f)
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
        item.productionYear?.let { MonoStrip("Anno $it", alpha = 0.7f); Dot() }
        item.runTimeTicks?.let {
            val mins = it / 600_000_000L
            val h = mins / 60
            val m = mins % 60
            MonoStrip(if (h > 0) "${h}H ${m}M" else "${m}M", alpha = 0.7f)
            Dot()
        }
        item.officialRating?.let { MonoStrip(it, alpha = 0.7f); Dot() }
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
private fun GenreChips(genres: List<String>, onSelect: (String) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 48.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MonoStrip("Genre", alpha = 0.5f)
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
            .clip(RoundedCornerShape(2.dp))
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.35f),
                shape = RoundedCornerShape(2.dp),
            )
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.08f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(
            text = label.uppercase(),
            color = StrataColors.Paper.copy(alpha = if (focused) 1f else 0.8f),
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.6.sp,
            ),
        )
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
