package com.strata.tv.ui.screens

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.navigation.NavController
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import org.jellyfin.sdk.model.api.BaseItemKind
import org.jellyfin.sdk.model.api.CollectionType
import java.util.UUID

@Composable
fun MoviesScreen(nav: NavController) {
    LibraryGrid(
        supportsSort = true,
        supportsLetterJump = true,
        supportsFilters = true,
        title = "Movies",
        onSelect = { nav.navigate(Routes.movieDetail(it.id.toString())) },
        load = { q ->
            ServiceLocator.repository.listMovies(
                sort = q.sort,
                nameStartsWith = q.nameStartsWith,
                filters = q.filters.ifEmpty { null },
            )
        },
    )
}

@Composable
fun ShowsScreen(nav: NavController) {
    LibraryGrid(
        supportsSort = true,
        supportsLetterJump = true,
        supportsFilters = true,
        title = "Shows",
        onSelect = { nav.navigate(Routes.showDetail(it.id.toString())) },
        load = { q ->
            ServiceLocator.repository.listShows(
                sort = q.sort,
                nameStartsWith = q.nameStartsWith,
                filters = q.filters.ifEmpty { null },
            )
        },
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

/**
 * Browse one library view ("My Media" tile → grid). Resolves the view's
 * collection type so a TV-shows library loads series and everything else loads
 * movies, then scopes the query to that view with `parentId`.
 */
@Composable
fun LibraryViewScreen(nav: NavController, viewId: String) {
    val id = UUID.fromString(viewId)
    val view by loadable(viewId) { ServiceLocator.repository.getItem(id) }
    when (val l = view) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> {
            val isShows = l.value.collectionType == CollectionType.TVSHOWS
            LibraryGrid(
                supportsSort = true,
                supportsLetterJump = true,
                supportsFilters = true,
                title = l.value.name,
                onSelect = { item -> navigateTo(nav, item) },
                load = { q ->
                    if (isShows) {
                        ServiceLocator.repository.listShows(
                            sort = q.sort, parentId = id,
                            nameStartsWith = q.nameStartsWith, filters = q.filters.ifEmpty { null },
                        )
                    } else {
                        ServiceLocator.repository.listMovies(
                            sort = q.sort, parentId = id,
                            nameStartsWith = q.nameStartsWith, filters = q.filters.ifEmpty { null },
                        )
                    }
                },
            )
        }
    }
}

/** Browse a single genre (reached from a detail-page genre chip). */
@Composable
fun GenreScreen(nav: NavController, name: String) {
    LibraryGrid(
        supportsSort = true,
        supportsFilters = true,
        title = name,
        onSelect = { nav.navigate(Routes.movieDetail(it.id.toString())) },
        load = { q ->
            ServiceLocator.repository.listMovies(
                sort = q.sort,
                genres = listOf(name),
                nameStartsWith = q.nameStartsWith,
                filters = q.filters.ifEmpty { null },
            )
        },
    )
}
