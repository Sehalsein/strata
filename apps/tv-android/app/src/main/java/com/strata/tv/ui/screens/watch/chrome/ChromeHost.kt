package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import com.strata.tv.data.StreamPlan
import kotlinx.coroutines.delay
import org.jellyfin.sdk.model.api.BaseItemDto

/**
 * Chrome host: lays the transport bar, track menus, info panel, and up-next
 * card over the player surface. The bar auto-hides 4s after the last key
 * press (mirrors Apple's `TransportChrome.autoHideDelay`).
 *
 * The host doesn't own the `PlayerEngine` lifecycle — `WatchScreen` does —
 * but it does wire all chrome events back into the engine via callbacks.
 */
@Composable
fun ChromeHost(
    engine: PlayerEngine,
    item: BaseItemDto,
    plan: StreamPlan,
    onBack: () -> Unit,
    upNext: BaseItemDto?,
    onPlayUpNext: (BaseItemDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    val status by engine.status.collectAsState()
    val positionMs by engine.positionMs.collectAsState()
    val durationMs by engine.durationMs.collectAsState()
    val audioTracks by engine.audioTracks.collectAsState()
    val subtitleTracks by engine.subtitleTracks.collectAsState()
    val selectedAudio by engine.selectedAudio.collectAsState()
    val selectedSubtitle by engine.selectedSubtitle.collectAsState()

    var chromeVisible by remember { mutableStateOf(true) }
    var menu by remember { mutableStateOf<ChromeMenu?>(null) }
    var scrubPos by remember { mutableStateOf<Long?>(null) }
    var lastInteractionMs by remember { mutableStateOf(System.currentTimeMillis()) }
    var upNextDismissed by remember(item.id) { mutableStateOf(false) }
    val playFocus = remember { FocusRequester() }

    fun bumpInteraction() {
        lastInteractionMs = System.currentTimeMillis()
        chromeVisible = true
    }

    LaunchedEffect(lastInteractionMs, menu, scrubPos) {
        if (menu != null || scrubPos != null) return@LaunchedEffect
        delay(4_000)
        if (System.currentTimeMillis() - lastInteractionMs >= 4_000) {
            chromeVisible = false
        }
    }

    LaunchedEffect(chromeVisible) {
        if (chromeVisible && menu == null) {
            runCatching { playFocus.requestFocus() }
        }
    }

    val showUpNext = upNext != null
        && !upNextDismissed
        && durationMs > 0
        && (durationMs - positionMs) in 0..30_000L

    Box(
        modifier = modifier
            .fillMaxSize()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (event.key) {
                    Key.Back, Key.Escape -> {
                        when {
                            menu != null -> { menu = null; bumpInteraction(); true }
                            chromeVisible -> { chromeVisible = false; true }
                            else -> { onBack(); true }
                        }
                    }
                    else -> {
                        bumpInteraction()
                        false
                    }
                }
            },
    ) {
        val trickplay = remember(item.id, plan.mediaSourceId) {
            trickplayFor(item, plan.mediaSourceId)
        }
        AnimatedVisibility(
            visible = scrubPos != null && trickplay != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 140.dp),
        ) {
            if (trickplay != null) {
                TrickplayThumbnail(
                    itemId = item.id,
                    info = trickplay,
                    positionMs = scrubPos ?: positionMs,
                )
            }
        }

        AnimatedVisibility(
            visible = chromeVisible,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            TransportBar(
                title = item.name.orEmpty(),
                subtitle = item.seriesName,
                status = status,
                positionMs = positionMs,
                durationMs = durationMs,
                onTogglePlay = {
                    engine.togglePlayPause()
                    bumpInteraction()
                },
                onSeek = { ms ->
                    engine.seekTo(ms)
                    bumpInteraction()
                },
                onScrubChange = { ms -> scrubPos = ms },
                onAudio = { menu = ChromeMenu.Audio },
                onSubtitles = { menu = ChromeMenu.Subtitles },
                onInfo = { menu = ChromeMenu.Info },
                playFocus = playFocus,
            )
        }

        when (menu) {
            ChromeMenu.Audio -> AudioMenu(
                tracks = audioTracks,
                selectedIndex = selectedAudio,
                onSelect = { track ->
                    engine.selectAudio(track)
                    bumpInteraction()
                },
                onDismiss = { menu = null; bumpInteraction() },
            )
            ChromeMenu.Subtitles -> SubtitleMenu(
                tracks = subtitleTracks,
                selectedIndex = selectedSubtitle,
                onSelect = { track ->
                    engine.selectSubtitle(track)
                    bumpInteraction()
                },
                onDismiss = { menu = null; bumpInteraction() },
            )
            ChromeMenu.Info -> StreamDetailsPanel(
                plan = plan,
                videoFormat = engine.exoPlayer.videoFormat,
                audioFormat = engine.exoPlayer.audioFormat,
                onDismiss = { menu = null; bumpInteraction() },
            )
            null -> Unit
        }

        if (upNext != null) {
            UpNextCard(
                next = upNext,
                visible = showUpNext,
                onConfirm = {
                    upNextDismissed = true
                    onPlayUpNext(upNext)
                },
                onDismiss = { upNextDismissed = true },
                modifier = Modifier.align(Alignment.BottomEnd),
            )
        }
    }
}

private enum class ChromeMenu { Audio, Subtitles, Info }
