package com.strata.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.foundation.lazy.list.items
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.paletteFor
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
        )
    }
    when (val l = bundle) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> ShowContent(nav, l.value)
    }
}

private data class ShowBundle(val series: BaseItemDto, val seasons: List<BaseItemDto>)

@Composable
private fun ShowContent(nav: NavController, bundle: ShowBundle) {
    val palette = paletteFor(bundle.series.id.toString())
    var selectedSeason by remember { mutableStateOf(bundle.seasons.firstOrNull()) }
    val episodes by loadable(bundle.series.id, selectedSeason?.id) {
        selectedSeason?.let { ServiceLocator.repository.getEpisodes(bundle.series.id, it.id) }
            ?: emptyList()
    }

    CompositionLocalProvider(LocalStrataPalette provides palette) {
        Box(modifier = Modifier.fillMaxSize()) {
            AsyncImage(
                model = ServiceLocator.repository.imageUrls.backdrop(bundle.series.id),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                modifier = Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0f to Color.Transparent,
                        0.5f to StrataColors.Bg.copy(alpha = 0.8f),
                        1f to StrataColors.Bg,
                    ),
                ),
            )

            Column(modifier = Modifier.fillMaxSize().padding(48.dp)) {
                Text(
                    text = bundle.series.name.orEmpty(),
                    style = MaterialTheme.typography.displayMedium,
                    color = StrataColors.Paper,
                )
                Row(
                    modifier = Modifier.fillMaxSize().padding(top = 32.dp),
                    horizontalArrangement = Arrangement.spacedBy(40.dp),
                ) {
                    // Season picker (left)
                    Column(
                        modifier = Modifier.width(220.dp).fillMaxHeight(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Seasons", color = StrataColors.Dim,
                            style = MaterialTheme.typography.labelMedium)
                        bundle.seasons.forEach { season ->
                            SeasonRow(
                                season = season,
                                isSelected = season.id == selectedSeason?.id,
                                onSelect = { selectedSeason = season },
                            )
                        }
                    }

                    // Episode list (right)
                    when (val l = episodes) {
                        is Loadable.Loading -> LoadingCenter()
                        is Loadable.Error -> ErrorCenter(l.cause)
                        is Loadable.Ready -> TvLazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(l.value, key = { it.id.toString() }) { ep ->
                                EpisodeRow(ep, onClick = {
                                    nav.navigate(Routes.watch(ep.id.toString()))
                                })
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SeasonRow(season: BaseItemDto, isSelected: Boolean, onSelect: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    Text(
        text = season.name.orEmpty(),
        color = when {
            focused -> StrataColors.Accent
            isSelected -> StrataColors.Paper
            else -> StrataColors.Paper.copy(alpha = 0.6f)
        },
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier
            .padding(vertical = 6.dp)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onSelect),
    )
}

@Composable
private fun EpisodeRow(episode: BaseItemDto, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (focused) StrataColors.Bg2 else Color.Transparent)
            .padding(16.dp)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = ServiceLocator.repository.imageUrls.thumb(episode.id),
            contentDescription = null,
            modifier = Modifier.width(220.dp).background(StrataColors.Bg2),
        )
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = "S${episode.parentIndexNumber ?: "?"}E${episode.indexNumber ?: "?"} · ${episode.name}",
                style = MaterialTheme.typography.titleMedium,
                color = StrataColors.Paper,
            )
            episode.overview?.let {
                Text(it, style = MaterialTheme.typography.bodySmall,
                    color = StrataColors.Paper.copy(alpha = 0.7f),
                    maxLines = 2)
            }
        }
    }
}
