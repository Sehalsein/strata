package com.strata.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jellyfin.sdk.api.client.extensions.playStateApi
import org.jellyfin.sdk.model.api.PlayMethod
import org.jellyfin.sdk.model.api.PlaybackOrder
import org.jellyfin.sdk.model.api.PlaybackProgressInfo
import org.jellyfin.sdk.model.api.PlaybackStartInfo
import org.jellyfin.sdk.model.api.PlaybackStopInfo
import org.jellyfin.sdk.model.api.RepeatMode
import java.util.UUID

/**
 * Port of `apps/web/src/lib/api.ts:385-433`. The Jellyfin SDK 1.6 DTOs
 * require booleans + enums for fields the web app never sets — supply
 * sane defaults (DIRECT_PLAY, REPEAT_NONE, PlaybackOrder.DEFAULT,
 * isMuted=false). The server ignores most of these on the receiving
 * end; what actually matters is itemId, playSessionId, positionTicks,
 * isPaused.
 */
class ProgressReporter(private val client: ApiClient) {

    suspend fun start(itemId: UUID, playSessionId: String, mediaSourceId: String) = withContext(Dispatchers.IO) {
        client.api.playStateApi.reportPlaybackStart(
            data = PlaybackStartInfo(
                canSeek = true,
                item = null,
                itemId = itemId,
                sessionId = null,
                mediaSourceId = mediaSourceId,
                audioStreamIndex = null,
                subtitleStreamIndex = null,
                isPaused = false,
                isMuted = false,
                positionTicks = 0L,
                playbackStartTimeTicks = null,
                volumeLevel = null,
                brightness = null,
                aspectRatio = null,
                playMethod = PlayMethod.DIRECT_PLAY,
                liveStreamId = null,
                playSessionId = playSessionId,
                repeatMode = RepeatMode.REPEAT_NONE,
                playbackOrder = PlaybackOrder.DEFAULT,
                nowPlayingQueue = null,
                playlistItemId = null,
            ),
        )
    }

    suspend fun progress(
        itemId: UUID,
        playSessionId: String,
        mediaSourceId: String,
        positionSeconds: Double,
        isPaused: Boolean,
    ) = withContext(Dispatchers.IO) {
        client.api.playStateApi.reportPlaybackProgress(
            data = PlaybackProgressInfo(
                canSeek = true,
                item = null,
                itemId = itemId,
                sessionId = null,
                mediaSourceId = mediaSourceId,
                audioStreamIndex = null,
                subtitleStreamIndex = null,
                isPaused = isPaused,
                isMuted = false,
                positionTicks = secondsToTicks(positionSeconds),
                playbackStartTimeTicks = null,
                volumeLevel = null,
                brightness = null,
                aspectRatio = null,
                playMethod = PlayMethod.DIRECT_PLAY,
                liveStreamId = null,
                playSessionId = playSessionId,
                repeatMode = RepeatMode.REPEAT_NONE,
                playbackOrder = PlaybackOrder.DEFAULT,
                nowPlayingQueue = null,
                playlistItemId = null,
            ),
        )
    }

    suspend fun stopped(
        itemId: UUID,
        playSessionId: String,
        mediaSourceId: String,
        positionSeconds: Double,
    ) = withContext(Dispatchers.IO) {
        client.api.playStateApi.reportPlaybackStopped(
            data = PlaybackStopInfo(
                item = null,
                itemId = itemId,
                sessionId = null,
                mediaSourceId = mediaSourceId,
                positionTicks = secondsToTicks(positionSeconds),
                liveStreamId = null,
                playSessionId = playSessionId,
                failed = false,
                nextMediaType = null,
                playlistItemId = null,
                nowPlayingQueue = null,
            ),
        )
    }

    companion object {
        fun secondsToTicks(seconds: Double): Long = (seconds * 10_000_000.0).toLong()
        fun ticksToSeconds(ticks: Long?): Double = (ticks ?: 0L) / 10_000_000.0
    }
}
