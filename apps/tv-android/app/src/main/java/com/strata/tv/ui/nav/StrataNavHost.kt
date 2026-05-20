package com.strata.tv.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.strata.tv.data.DeepLinkTarget
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.screens.HomeScreen
import com.strata.tv.ui.screens.LoginScreen
import com.strata.tv.ui.screens.MovieDetailScreen
import com.strata.tv.ui.screens.MoviesScreen
import com.strata.tv.ui.screens.SearchScreen
import com.strata.tv.ui.screens.ShowDetailScreen
import com.strata.tv.ui.screens.ShowsScreen
import com.strata.tv.ui.screens.watch.WatchScreen
import com.strata.tv.ui.shell.AppShell

object Routes {
    const val Home = "home"
    const val Login = "login"
    const val Movies = "movies"
    const val MovieDetail = "movies/{id}"
    const val Shows = "shows"
    const val ShowDetail = "shows/{id}"
    const val Watch = "watch/{id}"
    const val Search = "search"
    fun movieDetail(id: String) = "movies/$id"
    fun showDetail(id: String) = "shows/$id"
    fun watch(id: String) = "watch/$id"
}

@Composable
fun StrataNavHost(modifier: Modifier = Modifier) {
    val nav = rememberNavController()
    val session by ServiceLocator.authStore.session.collectAsState()
    val start = if (session != null) Routes.Home else Routes.Login

    // Drain `strata://` URIs into nav events. Only acted on when signed in —
    // a deep link delivered while logged out is held in the bus's replay
    // buffer until the next composition after auth completes.
    LaunchedEffect(session) {
        if (session == null) return@LaunchedEffect
        ServiceLocator.deepLinks.events.collect { target ->
            when (target) {
                is DeepLinkTarget.Movie -> nav.navigate(Routes.movieDetail(target.id))
                is DeepLinkTarget.Show -> nav.navigate(Routes.showDetail(target.id))
                is DeepLinkTarget.Watch -> nav.navigate(Routes.watch(target.id))
            }
        }
    }

    NavHost(navController = nav, startDestination = start, modifier = modifier) {
        composable(Routes.Login) {
            LoginScreen(onSignedIn = {
                nav.navigate(Routes.Home) {
                    popUpTo(Routes.Login) { inclusive = true }
                }
            })
        }
        composable(Routes.Home) {
            AppShell(nav) { HomeScreen(nav) }
        }
        composable(Routes.Movies) {
            AppShell(nav) { MoviesScreen(nav) }
        }
        composable(
            Routes.MovieDetail,
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            val id = entry.arguments?.getString("id").orEmpty()
            AppShell(nav) { MovieDetailScreen(nav, id) }
        }
        composable(Routes.Shows) {
            AppShell(nav) { ShowsScreen(nav) }
        }
        composable(
            Routes.ShowDetail,
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            val id = entry.arguments?.getString("id").orEmpty()
            AppShell(nav) { ShowDetailScreen(nav, id) }
        }
        composable(Routes.Search) {
            AppShell(nav) { SearchScreen(nav) }
        }
        composable(
            Routes.Watch,
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            // Watch route deliberately skips AppShell — it's full-bleed.
            val id = entry.arguments?.getString("id").orEmpty()
            WatchScreen(nav, id)
        }
    }
}
