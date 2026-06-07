package com.strata.tv.ui.screens.watch.chrome

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.strata.tv.data.StreamPlan
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
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
    val segments by engine.segments.collectAsState()
    val activeSkip = segments.firstOrNull { it.contains(positionMs) }
    val skipFocus = remember { FocusRequester() }

    var chromeVisible by remember { mutableStateOf(true) }
    var menu by remember { mutableStateOf<ChromeMenu?>(null) }
    var scrubPos by remember { mutableStateOf<Long?>(null) }
    var lastInteractionMs by remember { mutableStateOf(System.currentTimeMillis()) }
    var upNextDismissed by remember(item.id) { mutableStateOf(false) }
    val playFocus = remember { FocusRequester() }
    // When the chrome hides, its focusable controls leave composition and focus
    // would be lost — after which key events never reach onPreviewKeyEvent and
    // the chrome could never be summoned back. This focusable root holds focus
    // while the chrome is hidden so the next key press re-shows it.
    val rootFocus = remember { FocusRequester() }

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

    LaunchedEffect(chromeVisible, menu) {
        if (chromeVisible) {
            if (menu == null) runCatching { playFocus.requestFocus() }
        } else {
            // Park focus on the root so it keeps catching key presses.
            runCatching { rootFocus.requestFocus() }
        }
    }

    val showUpNext = upNext != null
        && !upNextDismissed
        && durationMs > 0
        && (durationMs - positionMs) in 0..30_000L

    Box(
        modifier = modifier
            .fillMaxSize()
            .focusRequester(rootFocus)
            .focusable()
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
                    // Center/Enter while the chrome is hidden: re-show it (and
                    // toggle play so the centre button still pauses fast).
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter, Key.Spacebar -> {
                        if (!chromeVisible) {
                            engine.togglePlayPause()
                            bumpInteraction()
                            true
                        } else {
                            bumpInteraction()
                            false
                        }
                    }
                    Key.MediaPlayPause, Key.MediaPlay, Key.MediaPause -> {
                        engine.togglePlayPause()
                        bumpInteraction()
                        true
                    }
                    else -> {
                        // Hidden: any key just summons the chrome (consume it so
                        // it isn't also treated as navigation). Visible: keep the
                        // chrome alive but let the key navigate the controls.
                        val wasHidden = !chromeVisible
                        bumpInteraction()
                        wasHidden
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

        // Skip Intro / Skip Credits — appears (and grabs focus) while the
        // playhead sits inside an intro/credits segment.
        if (activeSkip != null) {
            LaunchedEffect(activeSkip.isIntro, activeSkip.startMs) {
                runCatching { skipFocus.requestFocus() }
            }
            SkipButton(
                label = activeSkip.label,
                focusRequester = skipFocus,
                onClick = {
                    engine.seekTo(activeSkip.endMs)
                    bumpInteraction()
                },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 60.dp, bottom = 170.dp),
            )
        }
    }
}

@Composable
private fun SkipButton(
    label: String,
    focusRequester: FocusRequester,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "skip-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .scale(scale)
            .focusRequester(focusRequester)
            .clip(RoundedCornerShape(4.dp))
            .background(if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.9f))
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 14.dp),
    ) {
        Text(
            text = label,
            color = StrataColors.Ink,
            style = StrataText.Button,
        )
    }
}

private enum class ChromeMenu { Audio, Subtitles, Info }
