package com.strata.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jellyfin.sdk.api.client.extensions.mediaInfoApi
import org.jellyfin.sdk.model.api.MediaSourceInfo
import org.jellyfin.sdk.model.api.MediaStream
import org.jellyfin.sdk.model.api.MediaStreamType
import org.jellyfin.sdk.model.api.PlaybackInfoDto
import java.net.URLEncoder
import java.util.UUID

data class StreamPlan(
    val directUrl: String,
    val hlsUrl: String,
    val playSessionId: String,
    val mediaSourceId: String,
    /**
     * True when the source codec/container is *not* directly playable
     * by ExoPlayer and we must use the HLS transcode endpoint.
     * Inverted analogue of `apps/web/src/lib/api.ts:241-249.preferHls`.
     */
    val preferHls: Boolean,
    val bitrate: Int?,
    val subtitleStreams: List<SubtitleStream>,
    val audioStreams: List<AudioStream>,
)

data class SubtitleStream(
    val index: Int,
    val language: String?,
    val displayTitle: String?,
    val isExternal: Boolean,
    val isTextSubtitleStream: Boolean,
)

data class AudioStream(
    val index: Int,
    val language: String?,
    val displayTitle: String?,
    val channels: Int?,
    val codec: String?,
)

/**
 * Port of `apps/web/src/lib/api.ts:274-370.buildStreamPlan`. Same call
 * to `getPostedPlaybackInfo`, same query-string recipe for the HLS
 * master playlist. The container/codec check is *broader* than the
 * web's: ExoPlayer can direct-play mkv, opus, ac3, eac3, flac, vp9 —
 * so `preferHls` is false more often on TV than in the browser.
 */
class StreamPlanner(
    private val client: ApiClient,
    private val authStore: AuthStore,
) {
    suspend fun build(
        itemId: UUID,
        audioStreamIndex: Int? = null,
        subtitleStreamIndex: Int? = null,
    ): StreamPlan = withContext(Dispatchers.IO) {
        val userId = requireNotNull(authStore.userId()?.let(UUID::fromString)) {
            "Not signed in"
        }
        val res = client.api.mediaInfoApi.getPostedPlaybackInfo(
            itemId = itemId,
            data = PlaybackInfoDto(
                userId = userId,
                maxStreamingBitrate = MAX_BITRATE,
                audioStreamIndex = audioStreamIndex,
                subtitleStreamIndex = subtitleStreamIndex,
                autoOpenLiveStream = true,
                enableDirectPlay = true,
                enableDirectStream = true,
                enableTranscoding = true,
                allowVideoStreamCopy = true,
                allowAudioStreamCopy = true,
                maxAudioChannels = null,
                startTimeTicks = null,
                mediaSourceId = null,
                liveStreamId = null,
                deviceProfile = null,
            ),
        ).content

        val source = res.mediaSources.firstOrNull()
            ?: error("Jellyfin returned no media source")
        val sourceId = source.id ?: error("Media source missing id")
        val playSessionId = res.playSessionId.orEmpty()
        val token = authStore.accessToken().orEmpty()
        val video = pickStream(source, MediaStreamType.VIDEO, null)

        val directQs = qs(
            "Static" to "true",
            "MediaSourceId" to sourceId,
            "api_key" to token,
            "PlaySessionId" to playSessionId,
        )
        val directUrl = "${client.serverUrl}/Videos/$itemId/stream?$directQs"

        // Trust Jellyfin's TranscodingUrl. It encodes the right
        // container/codec/profile for the server's actual ffmpeg
        // capabilities (HW accel, tone-mapping, fdk_aac availability,
        // etc.) — far more reliable than constructing the m3u8 query
        // ourselves and forcing a tone-map the server can't fulfill.
        val transcodingUrl = source.transcodingUrl?.let {
            val prefix = if (it.startsWith("http")) "" else client.serverUrl
            val sep = if (it.contains("?")) "&" else "?"
            "$prefix$it${sep}api_key=${java.net.URLEncoder.encode(token, "UTF-8")}"
        }

        // Trust server flags. supportsDirectPlay = the file can stream as
        // bytes-on-wire (Static=true). Otherwise Jellyfin gave us the
        // exact transcode URL its ffmpeg can produce.
        val preferHls = !source.supportsDirectPlay && transcodingUrl != null
        val hlsUrl = transcodingUrl ?: directUrl

        val streams = source.mediaStreams.orEmpty()
        val subs = streams.filter { it.type == MediaStreamType.SUBTITLE }.map {
            SubtitleStream(
                index = it.index,
                language = it.language,
                displayTitle = it.displayTitle,
                isExternal = it.isExternal,
                isTextSubtitleStream = it.isTextSubtitleStream,
            )
        }
        val audios = streams.filter { it.type == MediaStreamType.AUDIO }.map {
            AudioStream(
                index = it.index,
                language = it.language,
                displayTitle = it.displayTitle,
                channels = it.channels,
                codec = it.codec,
            )
        }

        StreamPlan(
            directUrl = directUrl,
            hlsUrl = hlsUrl,
            playSessionId = playSessionId,
            mediaSourceId = sourceId,
            preferHls = preferHls,
            bitrate = video?.bitRate ?: source.bitrate,
            subtitleStreams = subs,
            audioStreams = audios,
        )
    }

    private fun pickStream(
        source: MediaSourceInfo,
        type: MediaStreamType,
        index: Int?,
    ): MediaStream? {
        val streams = source.mediaStreams.orEmpty()
        if (index != null) return streams.firstOrNull { it.type == type && it.index == index }
        return streams.firstOrNull { it.type == type && it.isDefault }
            ?: streams.firstOrNull { it.type == type }
    }

    private fun qs(vararg pairs: Pair<String, String>): String =
        pairs.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }

    companion object {
        private const val MAX_BITRATE = 120_000_000
        // Conservative direct-play set: mp4/h264/aac only. Jellyfin's
        // `/Videos/{id}/stream?Static=true` endpoint returns 404 for
        // many non-mp4 sources even when the codec is theoretically
        // ExoPlayer-decodable, so anything else goes through HLS where
        // Jellyfin stream-copies on the wire when compatible and
        // transcodes only when forced.
        private val EXOPLAYER_SAFE_CONTAINERS = setOf("mp4", "m4v")
        private val EXOPLAYER_SAFE_AUDIO = setOf("aac")
    }
}
