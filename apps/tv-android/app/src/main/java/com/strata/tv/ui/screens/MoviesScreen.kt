package com.strata.tv.ui.screens

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.navigation.NavController
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.PosterGrid
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes

@Composable
fun MoviesScreen(nav: NavController) {
    val data by loadable(Unit) { ServiceLocator.repository.listMovies() }
    val focus = remember { FocusRequester() }
    LaunchedEffect(data) {
        if (data is Loadable.Ready) runCatching { focus.requestFocus() }
    }
    when (val l = data) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> PosterGrid(
            items = l.value,
            onSelect = { nav.navigate(Routes.movieDetail(it.id.toString())) },
            firstFocusRequester = focus,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
fun ShowsScreen(nav: NavController) {
    val data by loadable(Unit) { ServiceLocator.repository.listShows() }
    val focus = remember { FocusRequester() }
    LaunchedEffect(data) {
        if (data is Loadable.Ready) runCatching { focus.requestFocus() }
    }
    when (val l = data) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> PosterGrid(
            items = l.value,
            onSelect = { nav.navigate(Routes.showDetail(it.id.toString())) },
            firstFocusRequester = focus,
            modifier = Modifier.fillMaxSize(),
        )
    }
}
