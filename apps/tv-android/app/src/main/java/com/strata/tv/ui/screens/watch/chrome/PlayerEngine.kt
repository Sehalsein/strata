package com.strata.tv.ui.screens.watch.chrome

import android.content.Context
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.exoplayer.ExoPlayer
import com.strata.tv.data.AudioStream
import com.strata.tv.data.StreamPlan
import com.strata.tv.data.SubtitleStream
import com.strata.tv.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.jellyfin.sdk.model.api.BaseItemDto
import java.util.UUID

/**
 * Compose-friendly state holder over `ExoPlayer`. Mirrors Apple's
 * `StrataPlayerUI.PlayerEngine`: a single object that owns the player
 * lifecycle, exposes observable state (position/duration/tracks/status),
 * and centralizes the HLS-on-error fallback + progress reporting that used
 * to live inline in `WatchScreen.kt`.
 *
 * Consumers should:
 *   1. Build with `remember { PlayerEngine(...) }`
 *   2. Call `attach(item, plan)` in a LaunchedEffect
 *   3. Render via the chrome composables, which read the StateFlows
 *   4. Call `release()` from a DisposableEffect's `onDispose`
 */
class PlayerEngine(
    private val context: Context,
    private val scope: CoroutineScope,
) {
    enum class Status { Idle, Loading, Ready, Playing, Paused, Ended, Failed }

    val exoPlayer: ExoPlayer = ExoPlayer.Builder(context).build()

    private val _status = MutableStateFlow(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()

    private val _positionMs = MutableStateFlow(0L)
    val positionMs: StateFlow<Long> = _positionMs.asStateFlow()

    private val _durationMs = MutableStateFlow(0L)
    val durationMs: StateFlow<Long> = _durationMs.asStateFlow()

    private val _audioTracks = MutableStateFlow<List<AudioStream>>(emptyList())
    val audioTracks: StateFlow<List<AudioStream>> = _audioTracks.asStateFlow()

    private val _subtitleTracks = MutableStateFlow<List<SubtitleStream>>(emptyList())
    val subtitleTracks: StateFlow<List<SubtitleStream>> = _subtitleTracks.asStateFlow()

    private val _selectedAudio = MutableStateFlow<Int?>(null)
    val selectedAudio: StateFlow<Int?> = _selectedAudio.asStateFlow()

    private val _selectedSubtitle = MutableStateFlow<Int?>(null)
    val selectedSubtitle: StateFlow<Int?> = _selectedSubtitle.asStateFlow()

    private val _failure = MutableStateFlow<PlaybackException?>(null)
    val failure: StateFlow<PlaybackException?> = _failure.asStateFlow()

    // Intro / credits segments (Jellyfin MediaSegments / intro-skipper).
    private val _segments = MutableStateFlow<List<SkipSegment>>(emptyList())
    val segments: StateFlow<List<SkipSegment>> = _segments.asStateFlow()

    fun setSegments(list: List<SkipSegment>) {
        _segments.value = list
    }

    private var currentItem: BaseItemDto? = null
    private var currentPlan: StreamPlan? = null
    private var positionPoller: Job? = null
    private var progressHeartbeat: Job? = null

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            _status.value = when (state) {
                Player.STATE_BUFFERING -> Status.Loading
                Player.STATE_READY ->
                    if (exoPlayer.playWhenReady) Status.Playing else Status.Paused
                Player.STATE_ENDED -> Status.Ended
                Player.STATE_IDLE -> Status.Idle
                else -> _status.value
            }
            _durationMs.value = exoPlayer.duration.coerceAtLeast(0)
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (_status.value !in setOf(Status.Loading, Status.Ended, Status.Failed)) {
                _status.value = if (isPlaying) Status.Playing else Status.Paused
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.e("Strata", "player error code=${error.errorCode} name=${error.errorCodeName}", error)
            val plan = currentPlan
            if (plan != null && !plan.preferHls) {
                // First-failure fallback: re-prepare with HLS at the same
                // position. Matches the previous inline behaviour in
                // WatchScreen.kt.
                val pos = exoPlayer.currentPosition / 1000.0
                scope.launch {
                    Log.i("Strata", "retrying via HLS at $pos s")
                    val fallback = plan.copy(preferHls = true)
                    currentPlan = fallback
                    load(fallback, pos)
                }
            } else {
                _status.value = Status.Failed
                _failure.value = error
            }
        }
    }

    init {
        exoPlayer.addListener(listener)
    }

    /** Bind a new item + plan to the engine. Resets position state. */
    fun attach(item: BaseItemDto, plan: StreamPlan, startSeconds: Double) {
        currentItem = item
        currentPlan = plan
        _audioTracks.value = plan.audioStreams
        _subtitleTracks.value = plan.subtitleStreams
        _selectedAudio.value = plan.audioStreams.firstOrNull()?.index
        _selectedSubtitle.value = null
        _segments.value = emptyList()
        load(plan, startSeconds)
        startPolling()
        startProgressHeartbeat(item.id, plan)
    }

    private fun load(plan: StreamPlan, position: Double) {
        val url = if (plan.preferHls) plan.hlsUrl else plan.directUrl
        Log.i("Strata", "player load preferHls=${plan.preferHls} position=$position url=$url")

        val item = currentItem ?: return
        val mediaItem = MediaItem.Builder()
            .setUri(url)
            .setMimeType(if (plan.preferHls) MimeTypes.APPLICATION_M3U8 else null)
            .setSubtitleConfigurations(
                plan.subtitleStreams
                    .filter { it.isTextSubtitleStream }
                    .map { sub ->
                        MediaItem.SubtitleConfiguration.Builder(
                            android.net.Uri.parse(
                                ServiceLocator.repository.imageUrls.subtitleVtt(
                                    item.id, plan.mediaSourceId, sub.index,
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

    fun togglePlayPause() {
        exoPlayer.playWhenReady = !exoPlayer.playWhenReady
    }

    fun seekTo(positionMs: Long) {
        exoPlayer.seekTo(positionMs.coerceIn(0, exoPlayer.duration.coerceAtLeast(0)))
        _positionMs.value = exoPlayer.currentPosition
    }

    fun seekBy(deltaMs: Long) {
        seekTo(exoPlayer.currentPosition + deltaMs)
    }

    /**
     * Switches the audio track via `TrackSelectionParameters`. ExoPlayer
     * resolves the actual `TrackGroup` from the language hint embedded in
     * the Jellyfin `MediaStream`. Falls back to no-op if no language.
     */
    fun selectAudio(stream: AudioStream) {
        _selectedAudio.value = stream.index
        val lang = stream.language ?: return
        exoPlayer.trackSelectionParameters = exoPlayer.trackSelectionParameters
            .buildUpon()
            .setPreferredAudioLanguage(lang)
            .build()
    }

    fun selectSubtitle(stream: SubtitleStream?) {
        _selectedSubtitle.value = stream?.index
        val params: TrackSelectionParameters = if (stream == null) {
            exoPlayer.trackSelectionParameters.buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .build()
        } else {
            exoPlayer.trackSelectionParameters.buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setPreferredTextLanguage(stream.language)
                .build()
        }
        exoPlayer.trackSelectionParameters = params
    }

    private fun startPolling() {
        positionPoller?.cancel()
        positionPoller = scope.launch {
            while (true) {
                _positionMs.value = exoPlayer.currentPosition
                _durationMs.value = exoPlayer.duration.coerceAtLeast(0)
                delay(250)
            }
        }
    }

    private fun startProgressHeartbeat(itemId: UUID, plan: StreamPlan) {
        progressHeartbeat?.cancel()
        val repo = ServiceLocator.repository
        progressHeartbeat = scope.launch {
            runCatching { repo.progress.start(itemId, plan.playSessionId, plan.mediaSourceId) }
            while (true) {
                delay(10_000)
                val pos = exoPlayer.currentPosition / 1000.0
                runCatching {
                    repo.progress.progress(
                        itemId,
                        plan.playSessionId,
                        plan.mediaSourceId,
                        pos,
                        !exoPlayer.isPlaying,
                    )
                }
            }
        }
    }

    /**
     * Releases ExoPlayer and reports a final stop event. Safe to call
     * multiple times; subsequent calls are no-ops because the player will
     * have been released.
     */
    fun release() {
        val item = currentItem
        val plan = currentPlan
        val pos = exoPlayer.currentPosition / 1000.0
        positionPoller?.cancel()
        progressHeartbeat?.cancel()
        if (item != null && plan != null) {
            scope.launch {
                runCatching {
                    ServiceLocator.repository.progress.stopped(
                        item.id, plan.playSessionId, plan.mediaSourceId, pos,
                    )
                }
            }
        }
        runCatching { exoPlayer.release() }
    }
}

/** A skippable intro/credits segment, in milliseconds. */
data class SkipSegment(
    val isIntro: Boolean,
    val startMs: Long,
    val endMs: Long,
) {
    val label: String get() = if (isIntro) "Skip Intro" else "Skip Credits"
    fun contains(ms: Long): Boolean = ms in startMs until endMs
}
