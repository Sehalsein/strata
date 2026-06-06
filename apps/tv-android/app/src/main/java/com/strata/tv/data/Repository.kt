package com.strata.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jellyfin.sdk.api.client.extensions.genresApi
import org.jellyfin.sdk.api.client.extensions.itemsApi
import org.jellyfin.sdk.api.client.extensions.libraryApi
import org.jellyfin.sdk.api.client.extensions.mediaSegmentsApi
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
import org.jellyfin.sdk.model.api.ItemFilter
import org.jellyfin.sdk.model.api.ItemSortBy
import org.jellyfin.sdk.model.api.MediaSegmentDto
import org.jellyfin.sdk.model.api.MediaSegmentType
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

    /** Saved profiles, for the "Who's watching?" chooser. */
    val accounts get() = authStore.accounts

    /** Switch the active profile (no re-auth — the token is stored). */
    fun switchAccount(userId: String) {
        authStore.switchAccount(userId)
        client.syncToken()
    }

    /** Remove a profile; falls back to another or signs out if it was the last. */
    fun removeAccount(userId: String) {
        authStore.removeAccount(userId)
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

    suspend fun listMovies(
        sort: LibrarySort = LibrarySort.RECENT,
        genres: List<String>? = null,
    ): List<BaseItemDto> = io {
        client.api.itemsApi.getItems(
            userId = userId(),
            includeItemTypes = listOf(BaseItemKind.MOVIE),
            recursive = true,
            sortBy = listOf(sort.by),
            sortOrder = listOf(sort.order),
            genres = genres,
            fields = movieFields,
        ).content.items.orEmpty()
    }

    suspend fun listShows(
        sort: LibrarySort = LibrarySort.RECENT,
        genres: List<String>? = null,
    ): List<BaseItemDto> = io {
        client.api.itemsApi.getItems(
            userId = userId(),
            includeItemTypes = listOf(BaseItemKind.SERIES),
            recursive = true,
            sortBy = listOf(sort.by),
            sortOrder = listOf(sort.order),
            genres = genres,
            fields = listOf(ItemFields.OVERVIEW, ItemFields.GENRES),
        ).content.items.orEmpty()
    }

    /** Distinct movie genres, for the genre browser reached from a detail chip. */
    suspend fun genreList(): List<String> = io {
        runCatching {
            client.api.genresApi.getGenres(
                userId = userId(),
                includeItemTypes = listOf(BaseItemKind.MOVIE),
            ).content.items.orEmpty().mapNotNull { it.name }
        }.getOrElse { emptyList() }
    }

    /** The user's favorited movies & series — the "My List" screen. */
    suspend fun favorites(): List<BaseItemDto> = io {
        client.api.itemsApi.getItems(
            userId = userId(),
            includeItemTypes = listOf(BaseItemKind.MOVIE, BaseItemKind.SERIES),
            recursive = true,
            filters = listOf(ItemFilter.IS_FAVORITE),
            sortBy = listOf(ItemSortBy.SORT_NAME),
            sortOrder = listOf(SortOrder.ASCENDING),
            fields = listOf(ItemFields.OVERVIEW, ItemFields.GENRES),
        ).content.items.orEmpty()
    }

    /**
     * Intro / credits segments (Jellyfin MediaSegments, populated by the
     * intro-skipper plugin). Empty when the plugin isn't present or hasn't
     * analysed the item, so the player simply shows no skip button.
     */
    suspend fun mediaSegments(itemId: UUID): List<MediaSegmentDto> = io {
        runCatching {
            client.api.mediaSegmentsApi.getItemSegments(
                itemId = itemId,
                includeSegmentTypes = listOf(MediaSegmentType.INTRO, MediaSegmentType.OUTRO),
            ).content.items.orEmpty()
        }.getOrElse { emptyList() }
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

/** How a library grid is ordered. Mirrors the Apple app's `ItemSort`. */
enum class LibrarySort(
    val label: String,
    val by: ItemSortBy,
    val order: SortOrder,
) {
    RECENT("Date Added", ItemSortBy.DATE_CREATED, SortOrder.DESCENDING),
    TITLE("Title", ItemSortBy.SORT_NAME, SortOrder.ASCENDING),
    YEAR("Year", ItemSortBy.PRODUCTION_YEAR, SortOrder.DESCENDING),
    RATING("Rating", ItemSortBy.COMMUNITY_RATING, SortOrder.DESCENDING),
    RUNTIME("Runtime", ItemSortBy.RUNTIME, SortOrder.DESCENDING),
}
