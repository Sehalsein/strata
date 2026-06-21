package com.strata.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jellyfin.sdk.api.client.extensions.mediaInfoApi
import org.jellyfin.sdk.model.api.DeviceProfile
import org.jellyfin.sdk.model.api.DlnaProfileType
import org.jellyfin.sdk.model.api.EncodingContext
import org.jellyfin.sdk.model.api.MediaSourceInfo
import org.jellyfin.sdk.model.api.MediaStream
import org.jellyfin.sdk.model.api.MediaStreamProtocol
import org.jellyfin.sdk.model.api.MediaStreamType
import org.jellyfin.sdk.model.api.PlaybackInfoDto
import org.jellyfin.sdk.model.api.SubtitleDeliveryMethod
import org.jellyfin.sdk.model.deviceprofile.buildDeviceProfile
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
    private val prefs: Prefs,
) {
    suspend fun build(
        itemId: UUID,
        audioStreamIndex: Int? = null,
        subtitleStreamIndex: Int? = null,
        // When true, tell Jellyfin to skip DirectPlay/DirectStream and hand back
        // a real transcode (HLS) URL. Used as the recovery path when a DirectPlay
        // attempt fails to decode on this device — see PlayerEngine.onPlayerError.
        // The user's "Force transcode" setting (Settings) ORs in here too.
        forceTranscode: Boolean = false,
        // The detail-screen version picker passes the chosen source id here; the
        // server scopes PlaybackInfo to it and we select the matching source
        // below. Null = let the server/first source win (the common single-file
        // case).
        mediaSourceId: String? = null,
    ): StreamPlan = withContext(Dispatchers.IO) {
        val userId = requireNotNull(authStore.userId()?.let(UUID::fromString)) {
            "Not signed in"
        }
        // Honor the user's "Force transcode" setting in addition to the caller's
        // recovery-path flag.
        val transcode = forceTranscode || prefs.forceTranscode()
        val res = client.api.mediaInfoApi.getPostedPlaybackInfo(
            itemId = itemId,
            data = PlaybackInfoDto(
                userId = userId,
                maxStreamingBitrate = prefs.maxStreamingBitrate(),
                audioStreamIndex = audioStreamIndex,
                subtitleStreamIndex = subtitleStreamIndex,
                autoOpenLiveStream = true,
                enableDirectPlay = !transcode,
                enableDirectStream = !transcode,
                enableTranscoding = true,
                allowVideoStreamCopy = true,
                allowAudioStreamCopy = true,
                maxAudioChannels = null,
                startTimeTicks = null,
                mediaSourceId = mediaSourceId,
                liveStreamId = null,
                // Sending DeviceProfile is what makes Jellyfin's
                // DirectPlay decision authoritative — without it the
                // server returned SupportsDirectPlay=false on every
                // MediaSource and we always fell through to the HLS
                // transcode. See [[jellyfin-deviceprofile-is-the-directplay-gate]].
                // Mirrors apps/web/src/lib/api.ts buildDeviceProfile()
                // and apps/apple/.../JellyfinClient.swift.
                deviceProfile = EXOPLAYER_DEVICE_PROFILE,
            ),
        ).content

        val source = mediaSourceId?.let { id -> res.mediaSources.firstOrNull { it.id == id } }
            ?: res.mediaSources.firstOrNull()
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
        val preferHls = (transcode || !source.supportsDirectPlay) && transcodingUrl != null
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

        /**
         * Codec / container support advertised to Jellyfin. Covers what
         * ExoPlayer / Media3 reliably handles on Android TV hardware:
         * - Containers: mp4, m4v, mov, mkv, webm.
         * - Video: h264, hevc (h265 alias), vp8, vp9, av1.
         * - Audio: aac, mp3, ac3, eac3, flac, opus, vorbis — all
         *   passthrough on modern Android TVs without re-encoding.
         *
         * Built once at class load (object scope); the contents don't
         * change per device or per call, so there's no point rebuilding
         * on every PlaybackInfo POST.
         */
        private val EXOPLAYER_DEVICE_PROFILE: DeviceProfile = buildDeviceProfile {
            name = "Strata Android TV"
            maxStreamingBitrate = MAX_BITRATE
            maxStaticBitrate = 200_000_000

            directPlayProfile {
                type = DlnaProfileType.VIDEO
                container("mp4", "m4v", "mov", "mkv", "webm")
                videoCodec("h264", "hevc", "h265", "vp8", "vp9", "av1")
                audioCodec("aac", "mp3", "ac3", "eac3", "flac", "opus", "vorbis", "alac")
            }
            directPlayProfile {
                type = DlnaProfileType.AUDIO
                container("mp3")
                audioCodec("mp3")
            }
            directPlayProfile {
                type = DlnaProfileType.AUDIO
                container("m4a", "aac")
                audioCodec("aac")
            }
            directPlayProfile {
                type = DlnaProfileType.AUDIO
                container("flac")
                audioCodec("flac")
            }
            directPlayProfile {
                type = DlnaProfileType.AUDIO
                container("opus", "ogg")
                audioCodec("opus", "vorbis")
            }

            // Fallback transcode profile. Only kicks in when the DirectPlay
            // profiles above all reject the source (or DirectPlay fails to
            // decode on-device). Deliberately h264 — a transcode is the
            // universally-decodable safety net, so we don't list hevc here
            // (which the server would stream-copy, reproducing the very codec
            // DirectPlay just failed on). DirectPlay above still keeps hevc/4K
            // source-quality on TVs that can decode it.
            transcodingProfile {
                type = DlnaProfileType.VIDEO
                container = "ts"
                protocol = MediaStreamProtocol.HLS
                context = EncodingContext.STREAMING
                videoCodec("h264")
                audioCodec("aac", "mp3", "ac3", "eac3")
                maxAudioChannels = "6"
                minSegments = 1
                breakOnNonKeyFrames = true
            }
            transcodingProfile {
                type = DlnaProfileType.AUDIO
                container = "mp3"
                protocol = MediaStreamProtocol.HTTP
                context = EncodingContext.STREAMING
                audioCodec("mp3")
            }

            subtitleProfile("vtt", SubtitleDeliveryMethod.EXTERNAL)
            subtitleProfile("ass", SubtitleDeliveryMethod.EXTERNAL)
            subtitleProfile("ssa", SubtitleDeliveryMethod.EXTERNAL)
            subtitleProfile("srt", SubtitleDeliveryMethod.EXTERNAL)
            subtitleProfile("sub", SubtitleDeliveryMethod.EXTERNAL)
            subtitleProfile("pgssub", SubtitleDeliveryMethod.EXTERNAL)
        }
    }
}
