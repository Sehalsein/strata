package com.strata.tv.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.strata.tv.data.ChannelSyncWorker
import com.strata.tv.data.DeepLinkTarget
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.screens.GenreScreen
import com.strata.tv.ui.screens.HomeScreen
import com.strata.tv.ui.screens.LibraryViewScreen
import com.strata.tv.ui.screens.LoginScreen
import com.strata.tv.ui.screens.MovieDetailScreen
import com.strata.tv.ui.screens.MoviesScreen
import com.strata.tv.ui.screens.MyListScreen
import com.strata.tv.ui.screens.ProfileScreen
import com.strata.tv.ui.screens.SearchScreen
import com.strata.tv.ui.screens.SettingsScreen
import com.strata.tv.ui.screens.ShowDetailScreen
import com.strata.tv.ui.screens.ShowsScreen
import com.strata.tv.ui.screens.watch.WatchScreen
import com.strata.tv.ui.shell.AppShell

object Routes {
    const val Home = "home"
    const val Login = "login"
    const val Profiles = "profiles"
    const val Movies = "movies"
    const val MovieDetail = "movies/{id}"
    const val Shows = "shows"
    const val ShowDetail = "shows/{id}"
    const val Watch = "watch/{id}?source={source}"
    const val Search = "search"
    const val MyList = "mylist"
    const val Genre = "genre/{name}"
    const val Library = "library/{id}"
    const val Settings = "settings"
    fun movieDetail(id: String) = "movies/$id"
    fun showDetail(id: String) = "shows/$id"
    fun watch(id: String, source: String? = null) =
        if (source == null) "watch/$id" else "watch/$id?source=${android.net.Uri.encode(source)}"
    fun genre(name: String) = "genre/${android.net.Uri.encode(name)}"
    fun library(id: String) = "library/$id"
}

@Composable
fun StrataNavHost(modifier: Modifier = Modifier) {
    val nav = rememberNavController()
    val context = LocalContext.current
    val session by ServiceLocator.authStore.session.collectAsState()
    val accounts by ServiceLocator.repository.accounts.collectAsState()
    // Computed once: a returning user with more than one profile lands on the
    // "Who's watching?" chooser; otherwise straight into Home.
    val start = remember {
        when {
            session == null -> Routes.Login
            accounts.size > 1 -> Routes.Profiles
            else -> Routes.Home
        }
    }

    // Signing out of the last profile drops the session to null — route back to
    // login and clear the stack so Back can't return to an unauthenticated app.
    LaunchedEffect(session == null) {
        if (session == null) {
            nav.navigate(Routes.Login) {
                popUpTo(0) { inclusive = true }
                launchSingleTop = true
            }
        }
    }

    // Drain `strata://` URIs into nav events. Only acted on when signed in —
    // a deep link delivered while logged out is held in the bus's replay
    // buffer until the next composition after auth completes.
    LaunchedEffect(session) {
        if (session == null) return@LaunchedEffect
        // A profile just signed in (or the app launched already signed in) —
        // refresh the TV launcher home-screen rows right away.
        ChannelSyncWorker.refresh(context)
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
        composable(Routes.Profiles) {
            ProfileScreen(nav)
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
        composable(Routes.MyList) {
            AppShell(nav) { MyListScreen(nav) }
        }
        composable(Routes.Settings) {
            AppShell(nav) { SettingsScreen(nav) }
        }
        composable(
            Routes.Library,
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            val id = entry.arguments?.getString("id").orEmpty()
            AppShell(nav) { LibraryViewScreen(nav, id) }
        }
        composable(
            Routes.Genre,
            arguments = listOf(navArgument("name") { type = NavType.StringType }),
        ) { entry ->
            val name = android.net.Uri.decode(entry.arguments?.getString("name").orEmpty())
            AppShell(nav) { GenreScreen(nav, name) }
        }
        composable(
            Routes.Watch,
            arguments = listOf(
                navArgument("id") { type = NavType.StringType },
                navArgument("source") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
        ) { entry ->
            // Watch route deliberately skips AppShell — it's full-bleed.
            val id = entry.arguments?.getString("id").orEmpty()
            val source = entry.arguments?.getString("source")
            WatchScreen(nav, id, source)
        }
    }
}
