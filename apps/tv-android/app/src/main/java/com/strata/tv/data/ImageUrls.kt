package com.strata.tv.data

import org.jellyfin.sdk.model.api.ImageType
import java.net.URLEncoder
import java.util.UUID

/**
 * Port of `apps/web/src/lib/api.ts:224-239` and 375-383.
 * Image URLs include `api_key` so Coil can fetch them without setting
 * an Authorization header per request.
 */
class ImageUrls(private val serverUrl: String, private val authStore: AuthStore) {

    fun image(itemId: UUID?, type: ImageType = ImageType.PRIMARY, maxWidth: Int? = null): String? {
        if (itemId == null) return null
        val params = buildList {
            if (maxWidth != null) add("maxWidth=$maxWidth")
            authStore.accessToken()?.let { add("api_key=${enc(it)}") }
        }
        val suffix = if (params.isEmpty()) "" else "?" + params.joinToString("&")
        return "$serverUrl/Items/$itemId/Images/${type.serialName}$suffix"
    }

    fun backdrop(itemId: UUID?): String? = image(itemId, ImageType.BACKDROP, maxWidth = 1920)
    fun thumb(itemId: UUID?): String? = image(itemId, ImageType.THUMB, maxWidth = 640)

    fun subtitleVtt(itemId: UUID, mediaSourceId: String, streamIndex: Int): String {
        val token = authStore.accessToken().orEmpty()
        return "$serverUrl/Videos/$itemId/$mediaSourceId/Subtitles/$streamIndex/0/Stream.vtt" +
            "?api_key=${enc(token)}"
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")
}

private val ImageType.serialName: String
    get() = when (this) {
        ImageType.PRIMARY -> "Primary"
        ImageType.BACKDROP -> "Backdrop"
        ImageType.THUMB -> "Thumb"
        ImageType.LOGO -> "Logo"
        ImageType.ART -> "Art"
        ImageType.BANNER -> "Banner"
        ImageType.DISC -> "Disc"
        ImageType.BOX -> "Box"
        ImageType.SCREENSHOT -> "Screenshot"
        ImageType.MENU -> "Menu"
        ImageType.CHAPTER -> "Chapter"
        ImageType.BOX_REAR -> "BoxRear"
        ImageType.PROFILE -> "Profile"
    }
