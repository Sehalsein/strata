package com.strata.tv.di

import android.content.Context
import com.strata.tv.BuildConfig
import com.strata.tv.data.ApiClient
import com.strata.tv.data.AuthStore
import com.strata.tv.data.Repository

object ServiceLocator {
    lateinit var authStore: AuthStore
        private set
    lateinit var apiClient: ApiClient
        private set
    lateinit var repository: Repository
        private set

    fun init(appContext: Context) {
        val ctx = appContext.applicationContext
        authStore = AuthStore(ctx)
        apiClient = ApiClient(
            appContext = ctx,
            serverUrl = BuildConfig.JELLYFIN_URL,
            authStore = authStore,
        )
        repository = Repository(apiClient, authStore)
    }
}
