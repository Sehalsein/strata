package com.strata.tv.ui.screens.watch

import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.navigation.NavController
import com.strata.tv.data.StreamPlan
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.loadable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jellyfin.sdk.model.api.BaseItemDto
import java.util.UUID

@Composable
fun WatchScreen(nav: NavController, id: String) {
    val itemId = UUID.fromString(id)
    val repo = ServiceLocator.repository

    val bundle by loadable(id) {
        val item = repo.getItem(itemId)
        val plan = repo.streamPlanner.build(itemId)
        WatchBundle(item, plan)
    }

    when (val l = bundle) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> PlayerHost(nav, l.value)
    }
}

private data class WatchBundle(val item: BaseItemDto, val plan: StreamPlan)

@Composable
private fun PlayerHost(nav: NavController, bundle: WatchBundle) {
    val context = LocalContext.current
    val repo = ServiceLocator.repository
    val scope = rememberCoroutineScope()
    val resumeSeconds = (bundle.item.userData?.playbackPositionTicks ?: 0L) / 10_000_000.0

    var currentPlan by remember { mutableStateOf(bundle.plan) }
    var playerState by remember { mutableStateOf<ExoPlayer?>(null) }

    val exoPlayer = remember {
        ExoPlayer.Builder(context).build().also { playerState = it }
    }

    fun load(plan: StreamPlan, position: Double) {
        val url = if (plan.preferHls) plan.hlsUrl else plan.directUrl
        android.util.Log.i(
            "Strata",
            "player load preferHls=${plan.preferHls} position=$position url=$url",
        )
        val mediaItem = MediaItem.Builder()
            .setUri(url)
            .setMimeType(if (plan.preferHls) MimeTypes.APPLICATION_M3U8 else null)
            .setSubtitleConfigurations(
                plan.subtitleStreams
                    .filter { it.isTextSubtitleStream }
                    .map { sub ->
                        MediaItem.SubtitleConfiguration.Builder(
                            android.net.Uri.parse(
                                repo.imageUrls.subtitleVtt(
                                    bundle.item.id, plan.mediaSourceId, sub.index,
                                ),
                            ),
                        )
                            .setMimeType(MimeTypes.TEXT_VTT)
                            .setLanguage(sub.language)
                            .setLabel(sub.displayTitle)
                            .setSelectionFlags(if (sub.index == 0) C.SELECTION_FLAG_DEFAULT else 0)
                            .build()
                    },
            )
            .build()
        exoPlayer.setMediaItem(mediaItem, (position * 1000).toLong())
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
    }

    // Initial load
    LaunchedEffect(currentPlan) {
        load(currentPlan, resumeSeconds)
        repo.progress.start(bundle.item.id, currentPlan.playSessionId, currentPlan.mediaSourceId)
    }

    // Any-error → HLS fallback (decoder, 404, network, codec — all covered)
    DisposableEffect(exoPlayer) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                android.util.Log.e(
                    "Strata",
                    "player error code=${error.errorCode} name=${error.errorCodeName}",
                    error,
                )
                if (!currentPlan.preferHls) {
                    val pos = exoPlayer.currentPosition / 1000.0
                    scope.launch {
                        android.util.Log.i("Strata", "retrying via HLS at $pos s")
                        val fallback = currentPlan.copy(preferHls = true)
                        currentPlan = fallback
                        load(fallback, pos)
                    }
                }
            }
        }
        exoPlayer.addListener(listener)
        onDispose { exoPlayer.removeListener(listener) }
    }

    // Progress heartbeat (mirrors Player.tsx 10 s loop)
    LaunchedEffect(exoPlayer) {
        while (true) {
            delay(10_000)
            val pos = exoPlayer.currentPosition / 1000.0
            runCatching {
                repo.progress.progress(
                    bundle.item.id,
                    currentPlan.playSessionId,
                    currentPlan.mediaSourceId,
                    pos,
                    !exoPlayer.isPlaying,
                )
            }
        }
    }

    // Cleanup: report stopped + release
    DisposableEffect(exoPlayer) {
        onDispose {
            val pos = exoPlayer.currentPosition / 1000.0
            scope.launch {
                runCatching {
                    repo.progress.stopped(
                        bundle.item.id,
                        currentPlan.playSessionId,
                        currentPlan.mediaSourceId,
                        pos,
                    )
                }
            }
            exoPlayer.release()
        }
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
                    useController = true
                    controllerAutoShow = true
                    setShowSubtitleButton(true)
                    setShowNextButton(false)
                    setShowPreviousButton(false)
                    player = exoPlayer
                }
            },
        )
    }
}
