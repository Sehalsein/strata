package com.strata.tv.data

import android.net.Uri
import android.util.Log
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Hand-off for inbound `strata://` URIs from `MainActivity` to the
 * navigation host. Mirrors Apple's `AppCoordinator.pendingRoute` — the
 * activity parses the `Uri`, posts a `DeepLinkTarget`, and the NavHost
 * consumes it once composition is settled.
 *
 * Buffered with `DROP_OLDEST` (capacity 1) so a deep link delivered before
 * the NavHost subscribes still survives the activity-create gap, but a
 * second link supersedes a stale one rather than queueing.
 */
class DeepLinkBus {
    private val _events = MutableSharedFlow<DeepLinkTarget>(
        replay = 1,
        extraBufferCapacity = 0,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<DeepLinkTarget> = _events.asSharedFlow()

    fun submit(uri: Uri?) {
        val target = parse(uri) ?: return
        Log.i("Strata", "deep link submitted: $uri → $target")
        _events.tryEmit(target)
    }

    fun consume() {
        _events.resetReplayCache()
    }

    /**
     * Accepts:
     *   strata://movie/{id}
     *   strata://show/{id}
     *   strata://watch/{id}
     * Returns null on anything else (silently ignored to avoid crash loops
     * from broken external links).
     */
    private fun parse(uri: Uri?): DeepLinkTarget? {
        if (uri == null) return null
        if (!uri.scheme.equals("strata", ignoreCase = true)) return null
        val id = uri.lastPathSegment ?: uri.host?.takeIf { it.isNotBlank() && uri.pathSegments.isEmpty() }
        val rawId = uri.pathSegments.firstOrNull() ?: return null
        return when (uri.host?.lowercase()) {
            "movie" -> DeepLinkTarget.Movie(rawId)
            "show" -> DeepLinkTarget.Show(rawId)
            "watch" -> DeepLinkTarget.Watch(rawId)
            else -> null
        }
    }
}

sealed class DeepLinkTarget {
    data class Movie(val id: String) : DeepLinkTarget()
    data class Show(val id: String) : DeepLinkTarget()
    data class Watch(val id: String) : DeepLinkTarget()
}
