package com.strata.tv.ui.screens.watch

import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.PlayerView
import androidx.navigation.NavController
import com.strata.tv.data.StreamPlan
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.screens.watch.chrome.ChromeHost
import com.strata.tv.ui.screens.watch.chrome.PlayerEngine
import com.strata.tv.ui.screens.watch.chrome.SkipSegment
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind
import org.jellyfin.sdk.model.api.MediaSegmentType
import java.util.UUID

@Composable
fun WatchScreen(nav: NavController, id: String) {
    val itemId = UUID.fromString(id)
    val repo = ServiceLocator.repository

    val bundle by loadable(id) {
        val item = repo.getItem(itemId)
        val plan = repo.streamPlanner.build(itemId)
        // Episodes get an up-next lookup; movies don't. Look up by series.
        val upNext = if (item.type == BaseItemKind.EPISODE) {
            item.seriesId?.let { repo.getNextUp(it) }?.takeIf { it.id != item.id }
        } else null
        val segments = repo.mediaSegments(itemId).mapNotNull { seg ->
            when (seg.type) {
                MediaSegmentType.INTRO -> SkipSegment(true, seg.startTicks / 10_000, seg.endTicks / 10_000)
                MediaSegmentType.OUTRO -> SkipSegment(false, seg.startTicks / 10_000, seg.endTicks / 10_000)
                else -> null
            }
        }
        WatchBundle(item, plan, upNext, segments)
    }

    when (val l = bundle) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> PlayerHost(nav, l.value)
    }
}

private data class WatchBundle(
    val item: BaseItemDto,
    val plan: StreamPlan,
    val upNext: BaseItemDto?,
    val segments: List<SkipSegment>,
)

@Composable
private fun PlayerHost(nav: NavController, bundle: WatchBundle) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val engine = remember(bundle.item.id) { PlayerEngine(context, scope) }
    val resumeSeconds = (bundle.item.userData?.playbackPositionTicks ?: 0L) / 10_000_000.0

    LaunchedEffect(bundle.item.id) {
        engine.attach(bundle.item, bundle.plan, resumeSeconds)
        engine.setSegments(bundle.segments)
    }

    DisposableEffect(engine) {
        onDispose { engine.release() }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                PlayerView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    // The Compose chrome replaces Media3's default controls.
                    useController = false
                    player = engine.exoPlayer
                }
            },
        )
        ChromeHost(
            engine = engine,
            item = bundle.item,
            plan = bundle.plan,
            onBack = { nav.popBackStack() },
            upNext = bundle.upNext,
            onPlayUpNext = { next ->
                nav.navigate(Routes.watch(next.id.toString())) {
                    popUpTo(Routes.Watch) { inclusive = true }
                }
            },
        )
    }
}
