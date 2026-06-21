package com.strata.tv.data

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import androidx.tvprovider.media.tv.PreviewChannel
import androidx.tvprovider.media.tv.PreviewChannelHelper
import androidx.tvprovider.media.tv.PreviewProgram
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram
import com.strata.tv.R
import org.jellyfin.sdk.model.api.BaseItemDto
import org.jellyfin.sdk.model.api.BaseItemKind

/**
 * Publishes content to the **Android TV launcher home screen** (the system
 * home, not the in-app Home tab):
 *
 *  - **Watch Next** — the system "Continue watching" row. We push resume items
 *    (CONTINUE, with a progress bar) and the next episode of in-progress series
 *    (NEXT). The launcher owns this row; the user can't remove the app from it.
 *  - **Preview channels** — "Latest Movies" and "Latest Series" rows the user
 *    can add to their home screen via the launcher's "Customize channels".
 *
 * Each program deep-links back through the existing `strata://` scheme
 * (see [DeepLinkBus]); the launcher fires an ACTION_VIEW intent that
 * `MainActivity` already forwards to navigation.
 *
 * Idempotent: re-running reconciles against what's already published, so the
 * periodic [ChannelSyncWorker] can call [sync] freely.
 */
class LauncherChannels(
    private val context: Context,
    private val repository: Repository,
) {
    private val helper = PreviewChannelHelper(context)
    private val images = repository.imageUrls

    suspend fun sync() {
        runCatching { syncWatchNext() }
            .onFailure { Log.w(TAG, "watch-next sync failed", it) }
        runCatching {
            val movies = repository.listMovies(LibrarySort.RECENT).take(MAX_PER_ROW)
            val shows = repository.listShows(LibrarySort.RECENT).take(MAX_PER_ROW)
            Log.i(TAG, "preview: ${movies.size} movies, ${shows.size} shows")
            syncPreviewChannel(CH_LATEST_MOVIES, "Latest Movies", movies)
            syncPreviewChannel(CH_LATEST_SERIES, "Latest Series", shows)
        }.onFailure { Log.w(TAG, "preview channel sync failed", it) }
    }

    // ------------------------------------------------------------------
    // Watch Next (Continue Watching + Next Up)
    // ------------------------------------------------------------------

    private suspend fun syncWatchNext() {
        val resume = repository.continueWatching()
        // Next Up minus anything already in resume, so a half-watched episode
        // doesn't appear twice.
        val resumeIds = resume.map { it.id }.toSet()
        val nextUp = repository.nextUp().filter { it.id !in resumeIds }
        Log.i(TAG, "watch-next: ${resume.size} resume, ${nextUp.size} next-up")

        val desired = LinkedHashMap<String, WatchNextProgram>()
        val now = System.currentTimeMillis()
        resume.forEachIndexed { i, item ->
            desired[item.id.toString()] = watchNext(item, continueWatching = true, engagement = now - i * 60_000L)
        }
        nextUp.forEachIndexed { i, item ->
            desired[item.id.toString()] =
                watchNext(item, continueWatching = false, engagement = now - (resume.size + i) * 60_000L)
        }

        // Reconcile against what we previously published (the provider scopes
        // this query to our own package).
        val existing = existingWatchNext()
        existing.forEach { (providerId, programId) ->
            if (providerId !in desired) {
                context.contentResolver.delete(
                    TvContractCompat.buildWatchNextProgramUri(programId), null, null,
                )
            }
        }
        desired.forEach { (providerId, program) ->
            val existingId = existing[providerId]
            if (existingId != null) {
                helper.updateWatchNextProgram(program, existingId)
            } else {
                helper.publishWatchNextProgram(program)
            }
        }
    }

    private fun watchNext(item: BaseItemDto, continueWatching: Boolean, engagement: Long): WatchNextProgram {
        val isEpisode = item.type == BaseItemKind.EPISODE
        val builder = WatchNextProgram.Builder()
            .setType(
                if (isEpisode) TvContractCompat.WatchNextPrograms.TYPE_TV_EPISODE
                else TvContractCompat.WatchNextPrograms.TYPE_MOVIE,
            )
            .setWatchNextType(
                if (continueWatching) TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE
                else TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_NEXT,
            )
            .setLastEngagementTimeUtcMillis(engagement)
            .setTitle(item.seriesName ?: item.name.orEmpty())
            .setPosterArtUri(Uri.parse(watchNextArt(item)))
            .setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_16_9)
            .setIntentUri(Uri.parse("strata://watch/${item.id}"))
            .setInternalProviderId(item.id.toString())
            .setDescription(item.overview.orEmpty())

        if (isEpisode) {
            item.name?.let { builder.setEpisodeTitle(it) }
            item.indexNumber?.let { builder.setEpisodeNumber(it) }
            item.parentIndexNumber?.let { builder.setSeasonNumber(it) }
        }

        // Resume progress bar: position + total duration in ms (ticks are 100ns).
        val durationMs = ((item.runTimeTicks ?: 0L) / 10_000L).toInt()
        val positionMs = ((item.userData?.playbackPositionTicks ?: 0L) / 10_000L).toInt()
        if (continueWatching && durationMs > 0 && positionMs > 0) {
            builder.setDurationMillis(durationMs).setLastPlaybackPositionMillis(positionMs)
        }
        return builder.build()
    }

    /** Episode still / series backdrop / movie backdrop — always 16:9 for the row. */
    private fun watchNextArt(item: BaseItemDto): String? = when (item.type) {
        BaseItemKind.EPISODE -> images.episodeStill(item) ?: images.backdrop(item.seriesId ?: item.id)
        else -> images.backdrop(item.id) ?: images.image(item.id, maxWidth = 640)
    }

    // Read id + provider-id columns directly rather than via
    // WatchNextProgram.fromCursor — the 1.0.0 builder NPEs on any row (even
    // another app's) that has a null description.
    private fun existingWatchNext(): Map<String, Long> {
        val out = HashMap<String, Long>()
        context.contentResolver.query(
            TvContractCompat.WatchNextPrograms.CONTENT_URI,
            arrayOf(COL_ID, COL_INTERNAL_PROVIDER_ID), null, null, null,
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(COL_ID)
            val ipidCol = cursor.getColumnIndexOrThrow(COL_INTERNAL_PROVIDER_ID)
            while (cursor.moveToNext()) {
                if (!cursor.isNull(ipidCol)) out[cursor.getString(ipidCol)] = cursor.getLong(idCol)
            }
        }
        return out
    }

    // ------------------------------------------------------------------
    // Preview channels (Latest Movies / Latest Series)
    // ------------------------------------------------------------------

    private fun syncPreviewChannel(providerId: String, title: String, items: List<BaseItemDto>) {
        if (items.isEmpty()) return
        val channelId = ensureChannel(providerId, title)

        // Reconcile programs: rebuild the channel's contents from scratch each
        // run. Simpler than diffing and a "latest" row is small.
        clearPrograms(channelId)
        items.forEach { item ->
            val isMovie = item.type == BaseItemKind.MOVIE
            val program = PreviewProgram.Builder()
                .setChannelId(channelId)
                .setType(
                    if (isMovie) TvContractCompat.PreviewPrograms.TYPE_MOVIE
                    else TvContractCompat.PreviewPrograms.TYPE_TV_SERIES,
                )
                .setTitle(item.name.orEmpty())
                .setDescription(item.overview.orEmpty())
                .setPosterArtUri(Uri.parse(images.image(item.id, maxWidth = 480)))
                .setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_MOVIE_POSTER)
                .setIntentUri(Uri.parse(if (isMovie) "strata://movie/${item.id}" else "strata://show/${item.id}"))
                .setInternalProviderId(item.id.toString())
                .build()
            runCatching { helper.publishPreviewProgram(program) }
        }
    }

    /** Find our channel by provider id, creating + logo-stamping it once. */
    private fun ensureChannel(providerId: String, title: String): Long {
        findChannel(providerId)?.let { return it }
        val launch = context.packageManager.getLeanbackLaunchIntentForPackage(context.packageName)
            ?: context.packageManager.getLaunchIntentForPackage(context.packageName)
        val channel = PreviewChannel.Builder()
            .setDisplayName(title)
            .setInternalProviderId(providerId)
            .apply {
                launch?.let { setAppLinkIntent(it) }
                // A channel needs a logo to surface in the launcher; reuse the
                // app banner.
                BitmapFactory.decodeResource(context.resources, R.drawable.banner)?.let { setLogo(it) }
            }
            .build()
        return helper.publishChannel(channel)
    }

    /** Our channel's row id, or null. Raw columns avoid the fromCursor NPE. */
    private fun findChannel(providerId: String): Long? {
        context.contentResolver.query(
            TvContractCompat.Channels.CONTENT_URI,
            arrayOf(COL_ID, COL_INTERNAL_PROVIDER_ID), null, null, null,
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(COL_ID)
            val ipidCol = cursor.getColumnIndexOrThrow(COL_INTERNAL_PROVIDER_ID)
            while (cursor.moveToNext()) {
                if (!cursor.isNull(ipidCol) && cursor.getString(ipidCol) == providerId) {
                    return cursor.getLong(idCol)
                }
            }
        }
        return null
    }

    private fun clearPrograms(channelId: Long) {
        context.contentResolver.query(
            TvContractCompat.PreviewPrograms.CONTENT_URI,
            arrayOf(COL_ID, COL_CHANNEL_ID), null, null, null,
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(COL_ID)
            val chCol = cursor.getColumnIndexOrThrow(COL_CHANNEL_ID)
            while (cursor.moveToNext()) {
                if (cursor.getLong(chCol) == channelId) {
                    context.contentResolver.delete(
                        TvContractCompat.buildPreviewProgramUri(cursor.getLong(idCol)), null, null,
                    )
                }
            }
        }
    }

    private companion object {
        const val TAG = "Strata.Channels"
        const val MAX_PER_ROW = 20
        const val CH_LATEST_MOVIES = "strata-latest-movies"
        const val CH_LATEST_SERIES = "strata-latest-series"

        // Canonical TvContract DB column names. Read directly so we never route
        // arbitrary rows through the 1.0.0 *.fromCursor builders, which NPE on a
        // null description.
        const val COL_ID = "_id"
        const val COL_INTERNAL_PROVIDER_ID = "internal_provider_id"
        const val COL_CHANNEL_ID = "channel_id"
    }
}
