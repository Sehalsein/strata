package com.strata.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jellyfin.sdk.api.client.extensions.itemsApi
import org.jellyfin.sdk.api.client.extensions.libraryApi
import org.jellyfin.sdk.api.client.extensions.tvShowsApi
import org.jellyfin.sdk.api.client.extensions.userApi
import org.jellyfin.sdk.api.client.extensions.userLibraryApi
import org.jellyfin.sdk.api.client.extensions.userViewsApi
import org.jellyfin.sdk.api.operations.QuickConnectApi
import org.jellyfin.sdk.model.api.AuthenticateUserByName
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind
import org.jellyfin.sdk.model.api.BaseItemPerson
import org.jellyfin.sdk.model.api.ItemFields
import org.jellyfin.sdk.model.api.ItemSortBy
import org.jellyfin.sdk.model.api.QuickConnectDto
import org.jellyfin.sdk.model.api.QuickConnectResult
import org.jellyfin.sdk.model.api.SortOrder
import java.util.UUID

private suspend inline fun <T> io(crossinline block: suspend () -> T): T =
    withContext(Dispatchers.IO) { block() }

/**
 * 1:1 port of the query functions in `apps/web/src/lib/api.ts:107-222`.
 * Thin wrapper around the Jellyfin Kotlin SDK; screens read like their
 * React counterparts. All DTO-shaped calls per Jellyfin SDK 1.6.x —
 * `userApi.authenticateUserByName(data = AuthenticateUserByName(...))`
 * etc.
 */
class Repository(
    private val client: ApiClient,
    private val authStore: AuthStore,
) {
    val streamPlanner = StreamPlanner(client, authStore)
    val progress = ProgressReporter(client)
    val imageUrls = ImageUrls(client.serverUrl, authStore)
    val serverUrl: String get() = client.serverUrl

    // ---------------------------------------------------------------------
    // Auth
    // ---------------------------------------------------------------------

    /**
     * Sign in. The server URL is treated like a credential here — we
     * persist it before authenticating so the SDK uses the new base URL
     * on the very next call. Mirrors Apple's `AuthStore.signIn(serverURL,
     * username, password)` ordering.
     */
    suspend fun signInWithPassword(
        serverUrl: String,
        username: String,
        password: String,
    ) = io {
        if (serverUrl.isNotBlank() && serverUrl != authStore.serverUrl()) {
            authStore.persistServerUrl(serverUrl)
            client.syncToken()
        }
        val res = client.api.userApi.authenticateUserByName(
            data = AuthenticateUserByName(username = username, pw = password),
        ).content
        persist(res.accessToken, res.user?.id?.toString(), res.user?.name)
    }

    suspend fun quickConnectInitiate(): QuickConnectResult = io {
        QuickConnectApi(client.api).initiateQuickConnect().content
    }

    suspend fun quickConnectPoll(secret: String): QuickConnectResult = io {
        QuickConnectApi(client.api).getQuickConnectState(secret = secret).content
    }

    suspend fun authenticateWithQuickConnect(secret: String) = io {
        val res = client.api.userApi.authenticateWithQuickConnect(
            data = QuickConnectDto(secret = secret),
        ).content
        persist(res.accessToken, res.user?.id?.toString(), res.user?.name)
    }

    private fun persist(token: String?, userId: String?, userName: String?) {
        val t = requireNotNull(token) { "missing access token" }
        val u = requireNotNull(userId) { "missing user id" }
        authStore.persistAuth(t, u, userName)
        client.syncToken()
    }

    fun signOut() {
        authStore.clear()
        client.syncToken()
    }

    // ---------------------------------------------------------------------
    // Library
    // ---------------------------------------------------------------------

    // Browse views deliberately skip MEDIA_SOURCES / MEDIA_STREAMS — those
    // are codec-level metadata only the player needs, and any unknown
    // enum value (e.g. a new VideoRangeType like DOVIWithHDR10Plus that
    // the SDK predates) makes the whole list deserialization throw.
    // getItem() and buildStreamPlan() fetch them per-item where needed.
    private val movieFields = listOf(
        ItemFields.OVERVIEW,
        ItemFields.GENRES,
        ItemFields.ORIGINAL_TITLE,
        ItemFields.TAGLINES,
    )

    suspend fun listMovies(): List<BaseItemDto> = io {
        client.api.itemsApi.getItems(
            userId = userId(),
            includeItemTypes = listOf(BaseItemKind.MOVIE),
            recursive = true,
            sortBy = listOf(ItemSortBy.DATE_CREATED),
            sortOrder = listOf(SortOrder.DESCENDING),
            fields = movieFields,
        ).content.items.orEmpty()
    }

    suspend fun listShows(): List<BaseItemDto> = io {
        client.api.itemsApi.getItems(
            userId = userId(),
            includeItemTypes = listOf(BaseItemKind.SERIES),
            recursive = true,
            sortBy = listOf(ItemSortBy.DATE_CREATED),
            sortOrder = listOf(SortOrder.DESCENDING),
            fields = listOf(ItemFields.OVERVIEW, ItemFields.GENRES),
        ).content.items.orEmpty()
    }

    suspend fun getItem(itemId: UUID): BaseItemDto = io {
        client.api.userLibraryApi.getItem(
            userId = userId(),
            itemId = itemId,
        ).content
    }

    suspend fun getSeasons(seriesId: UUID): List<BaseItemDto> = io {
        client.api.tvShowsApi.getSeasons(
            userId = userId(),
            seriesId = seriesId,
        ).content.items.orEmpty()
    }

    suspend fun getEpisodes(seriesId: UUID, seasonId: UUID? = null): List<BaseItemDto> = io {
        client.api.tvShowsApi.getEpisodes(
            userId = userId(),
            seriesId = seriesId,
            seasonId = seasonId,
            fields = listOf(ItemFields.OVERVIEW),
        ).content.items.orEmpty()
    }

    suspend fun continueWatching(): List<BaseItemDto> = io {
        client.api.itemsApi.getResumeItems(
            userId = userId(),
            includeItemTypes = listOf(BaseItemKind.MOVIE, BaseItemKind.EPISODE),
            limit = 12,
            fields = listOf(ItemFields.OVERVIEW),
        ).content.items.orEmpty()
    }

    suspend fun search(term: String): SearchResults = io {
        if (term.trim().length < 2) return@io SearchResults(emptyList(), emptyList())
        val items = client.api.itemsApi.getItems(
            userId = userId(),
            searchTerm = term,
            includeItemTypes = listOf(BaseItemKind.MOVIE, BaseItemKind.SERIES),
            recursive = true,
            limit = 50,
            fields = listOf(ItemFields.OVERVIEW),
        ).content.items.orEmpty()
        SearchResults(
            movies = items.filter { it.type == BaseItemKind.MOVIE },
            shows = items.filter { it.type == BaseItemKind.SERIES },
        )
    }

    suspend fun featured(): List<BaseItemDto> = io {
        client.api.userViewsApi.getUserViews(userId = userId()).content.items.orEmpty()
    }

    /**
     * Items similar to the given movie/show. Used by the detail screen to
     * surface a "More like this" shelf (mirrors Apple's `SimilarShelf`).
     */
    suspend fun getSimilarItems(itemId: UUID, limit: Int = 12): List<BaseItemDto> = io {
        runCatching {
            client.api.libraryApi.getSimilarItems(
                itemId = itemId,
                userId = userId(),
                limit = limit,
                fields = listOf(ItemFields.OVERVIEW),
            ).content.items.orEmpty()
        }.getOrElse { emptyList() }
    }

    /**
     * Episode that should auto-play after the given one. Used by the
     * player's up-next card. Returns null on the last episode of the series.
     */
    suspend fun getNextUp(seriesId: UUID): BaseItemDto? = io {
        runCatching {
            client.api.tvShowsApi.getNextUp(
                userId = userId(),
                seriesId = seriesId,
                limit = 1,
                fields = listOf(ItemFields.OVERVIEW),
            ).content.items.orEmpty().firstOrNull()
        }.getOrNull()
    }

    /**
     * Watchlist toggle. Optimistic UI lives in the caller; we just push
     * the new state to the server and let the next `getItem` confirm it.
     */
    suspend fun setFavorite(itemId: UUID, isFavorite: Boolean): Unit = io {
        if (isFavorite) {
            client.api.userLibraryApi.markFavoriteItem(userId = userId(), itemId = itemId)
        } else {
            client.api.userLibraryApi.unmarkFavoriteItem(userId = userId(), itemId = itemId)
        }
    }

    /** Cast / crew already arrives on `BaseItemDto.people`; this is a typed sugar. */
    fun castOf(item: BaseItemDto): List<BaseItemPerson> = item.people.orEmpty()

    private fun userId(): UUID = UUID.fromString(
        requireNotNull(authStore.userId()) { "Not signed in" },
    )
}

data class SearchResults(val movies: List<BaseItemDto>, val shows: List<BaseItemDto>)
