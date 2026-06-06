package com.strata.tv.ui.screens

import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.nav.Routes
import org.jellyfin.sdk.model.api.BaseItemKind

@Composable
fun MoviesScreen(nav: NavController) {
    LibraryGrid(
        supportsSort = true,
        title = "Movies",
        onSelect = { nav.navigate(Routes.movieDetail(it.id.toString())) },
        load = { sort -> ServiceLocator.repository.listMovies(sort) },
    )
}

@Composable
fun ShowsScreen(nav: NavController) {
    LibraryGrid(
        supportsSort = true,
        title = "Shows",
        onSelect = { nav.navigate(Routes.showDetail(it.id.toString())) },
        load = { sort -> ServiceLocator.repository.listShows(sort) },
    )
}

/** The user's favorited titles — "My List". */
@Composable
fun MyListScreen(nav: NavController) {
    LibraryGrid(
        supportsSort = false,
        title = "My List",
        onSelect = { item ->
            if (item.type == BaseItemKind.SERIES) {
                nav.navigate(Routes.showDetail(item.id.toString()))
            } else {
                nav.navigate(Routes.movieDetail(item.id.toString()))
            }
        },
        load = { ServiceLocator.repository.favorites() },
    )
}

/** Browse a single genre (reached from a detail-page genre chip). */
@Composable
fun GenreScreen(nav: NavController, name: String) {
    LibraryGrid(
        supportsSort = true,
        title = name,
        onSelect = { nav.navigate(Routes.movieDetail(it.id.toString())) },
        load = { sort -> ServiceLocator.repository.listMovies(sort, genres = listOf(name)) },
    )
}
