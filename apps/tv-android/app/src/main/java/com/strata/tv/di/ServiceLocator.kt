package com.strata.tv.di

import android.content.Context
import com.strata.tv.BuildConfig
import com.strata.tv.data.ApiClient
import com.strata.tv.data.AuthStore
import com.strata.tv.data.DeepLinkBus
import com.strata.tv.data.Prefs
import com.strata.tv.data.Repository

object ServiceLocator {
    lateinit var authStore: AuthStore
        private set
    lateinit var apiClient: ApiClient
        private set
    lateinit var prefs: Prefs
        private set
    lateinit var repository: Repository
        private set
    val deepLinks = DeepLinkBus()

    fun init(appContext: Context) {
        val ctx = appContext.applicationContext
        authStore = AuthStore(ctx, defaultServerUrl = BuildConfig.JELLYFIN_URL)
        apiClient = ApiClient(appContext = ctx, authStore = authStore)
        prefs = Prefs(ctx)
        repository = Repository(apiClient, authStore, prefs)
    }
}
