package com.strata.tv.data

import org.jellyfin.sdk.model.api.BaseItemDto
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

    /**
     * Title logo (`/Items/{id}/Images/Logo`). Returns null when the item has no
     * logo tag so the detail hero falls back to rendering the title as text
     * rather than firing a request that 404s.
     */
    fun logo(item: BaseItemDto, maxWidth: Int = 720): String? {
        if (item.imageTags.orEmpty()[ImageType.LOGO] == null) return null
        return image(item.id, ImageType.LOGO, maxWidth = maxWidth)
    }

    // Jellyfin stores the episode still frame under the `Primary` image tag.
    // `Thumb` is rarely populated for episodes — checking imageTags lets us skip
    // the request entirely when neither exists.
    fun episodeStill(episode: BaseItemDto, maxWidth: Int = 640): String? {
        val tags = episode.imageTags.orEmpty()
        return when {
            tags[ImageType.PRIMARY] != null -> image(episode.id, ImageType.PRIMARY, maxWidth)
            tags[ImageType.THUMB] != null   -> image(episode.id, ImageType.THUMB, maxWidth)
            else -> null
        }
    }

    /**
     * Cast / crew portrait. BaseItemPerson.id is also a Jellyfin item id, so
     * the same `/Items/{id}/Images/Primary` endpoint applies.
     */
    fun person(personId: UUID?, maxWidth: Int = 320): String? =
        image(personId, ImageType.PRIMARY, maxWidth = maxWidth)

    /**
     * A profile avatar (`/Users/{id}/Images/Primary`). Takes the account's own
     * server + token explicitly so the chooser can show every profile's avatar,
     * even ones not currently active. Jellyfin 404s when no image is set, so
     * callers fall back to initials.
     */
    fun userAvatar(account: Account, maxWidth: Int = 240): String {
        val params = buildList {
            add("maxWidth=$maxWidth")
            if (account.token.isNotEmpty()) add("api_key=${enc(account.token)}")
        }
        return "${account.serverUrl}/Users/${account.userId}/Images/Primary?" +
            params.joinToString("&")
    }

    /** Chapter thumbnail rendered above each scene marker. */
    fun chapter(itemId: UUID, index: Int, maxWidth: Int = 480): String {
        val params = buildList {
            add("maxWidth=$maxWidth")
            authStore.accessToken()?.let { add("api_key=${enc(it)}") }
        }
        return "$serverUrl/Items/$itemId/Images/Chapter/$index?" + params.joinToString("&")
    }

    /**
     * Trickplay tile (Jellyfin ≥ 10.9). Each tile is a grid of thumbnails
     * (tileWidth × tileHeight) covering `interval` ms each, so position p ms
     * maps to: thumbIndex = p / interval; tileIndex = thumbIndex /
     * (tileWidth * tileHeight); thumbnailWithinTile = thumbIndex % (tileWidth
     * * tileHeight). The caller crops to the right cell.
     */
    fun trickplayTile(itemId: UUID, width: Int, tileIndex: Int): String {
        val token = authStore.accessToken().orEmpty()
        return "$serverUrl/Videos/$itemId/Trickplay/$width/$tileIndex.jpg" +
            "?api_key=${enc(token)}"
    }

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
