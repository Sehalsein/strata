package com.strata.tv

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.strata.tv.di.ServiceLocator

class StrataApp : Application(), SingletonImageLoader.Factory {
    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(this)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                add(OkHttpNetworkFetcherFactory())
            }
            .build()
}
