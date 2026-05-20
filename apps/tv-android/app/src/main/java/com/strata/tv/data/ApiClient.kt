package com.strata.tv.data

import android.content.Context
import org.jellyfin.sdk.Jellyfin
import org.jellyfin.sdk.api.client.ApiClient as JellyfinApi
import org.jellyfin.sdk.createJellyfin
import org.jellyfin.sdk.model.ClientInfo
import org.jellyfin.sdk.model.DeviceInfo

/**
 * Builds the Jellyfin SDK client once at app start. Mirrors
 * `apps/web/src/lib/api.ts:63-74`. The Jellyfin SDK 1.6 makes the
 * api's `accessToken` and `baseUrl` `val`s, so we rotate the api
 * whenever either changes via `jellyfin.createApi(...)` and expose it
 * behind a read-only property.
 *
 * The Android variant of the SDK requires an application Context so
 * it can populate device info (model/manufacturer/locale) — it
 * crashes at `createJellyfin {}` build time otherwise.
 */
class ApiClient(
    appContext: Context,
    private val authStore: AuthStore,
) {
    private val jellyfin: Jellyfin = createJellyfin {
        context = appContext.applicationContext
        clientInfo = ClientInfo(name = "Strata", version = "1.0.0")
        deviceInfo = DeviceInfo(id = authStore.deviceId(), name = "Strata TV")
    }

    /** Always reads from AuthStore so subsequent calls follow the user's choice. */
    val serverUrl: String get() = authStore.serverUrl()

    @Volatile
    var api: JellyfinApi = build()
        private set

    /** Call after AuthStore.persistAuth / persistServerUrl / clear so subsequent
     *  SDK calls use the new token and base URL. */
    @Synchronized
    fun syncToken() {
        api = build()
    }

    private fun build(): JellyfinApi = jellyfin.createApi(
        baseUrl = serverUrl,
        accessToken = authStore.accessToken(),
    )
}
