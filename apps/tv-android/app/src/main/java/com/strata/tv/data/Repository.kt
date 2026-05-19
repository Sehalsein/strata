package com.strata.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jellyfin.sdk.api.client.extensions.itemsApi
import org.jellyfin.sdk.api.client.extensions.tvShowsApi
import org.jellyfin.sdk.api.client.extensions.userApi
import org.jellyfin.sdk.api.client.extensions.userLibraryApi
import org.jellyfin.sdk.api.client.extensions.userViewsApi
import org.jellyfin.sdk.api.operations.QuickConnectApi
import org.jellyfin.sdk.model.api.AuthenticateUserByName
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind
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

    suspend fun signInWithPassword(username: String, password: String) = io {
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

    private fun userId(): UUID = UUID.fromString(
        requireNotNull(authStore.userId()) { "Not signed in" },
    )
}

data class SearchResults(val movies: List<BaseItemDto>, val shows: List<BaseItemDto>)
