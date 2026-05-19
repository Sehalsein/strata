package com.strata.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.strata.tv.data.SearchResults
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.PosterRow
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.StrataColors
import kotlinx.coroutines.delay

@Composable
fun SearchScreen(nav: NavController) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf(SearchResults(emptyList(), emptyList())) }

    LaunchedEffect(query) {
        if (query.length < 2) {
            results = SearchResults(emptyList(), emptyList()); return@LaunchedEffect
        }
        delay(300) // debounce
        results = runCatching { ServiceLocator.repository.search(query) }
            .getOrDefault(SearchResults(emptyList(), emptyList()))
    }

    Column(modifier = Modifier.fillMaxSize().padding(top = 24.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Search") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(0.6f),
        )
        TvLazyColumn(
            modifier = Modifier.fillMaxSize().padding(top = 24.dp),
            verticalArrangement = Arrangement.spacedBy(32.dp),
            contentPadding = PaddingValues(vertical = 16.dp),
        ) {
            if (results.movies.isNotEmpty()) {
                item {
                    Text("Films", color = StrataColors.Paper,
                        style = MaterialTheme.typography.titleLarge)
                }
                item {
                    PosterRow(
                        items = results.movies,
                        onSelect = { nav.navigate(Routes.movieDetail(it.id.toString())) },
                    )
                }
            }
            if (results.shows.isNotEmpty()) {
                item {
                    Text("Series", color = StrataColors.Paper,
                        style = MaterialTheme.typography.titleLarge)
                }
                item {
                    PosterRow(
                        items = results.shows,
                        onSelect = { nav.navigate(Routes.showDetail(it.id.toString())) },
                    )
                }
            }
        }
    }
}
