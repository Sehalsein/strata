package com.strata.tv.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.strata.tv.di.ServiceLocator
import java.util.concurrent.TimeUnit

/**
 * Keeps the TV launcher home-screen rows fresh. Runs periodically (so the rows
 * update even when the app is closed) and once whenever a profile signs in /
 * the app foregrounds, via [refresh].
 *
 * No-op when signed out — there's nothing user-specific to publish.
 */
class ChannelSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val signedIn = ServiceLocator.authStore.userId() != null
        android.util.Log.i("Strata.Channels", "sync worker run; signedIn=$signedIn")
        if (!signedIn) return Result.success()
        return runCatching {
            LauncherChannels(applicationContext, ServiceLocator.repository).sync()
            Result.success()
        }.getOrElse { Result.retry() }
    }

    companion object {
        private const val PERIODIC = "strata-channel-sync"
        private const val ONESHOT = "strata-channel-sync-now"

        /** Schedule the recurring refresh. Call once from Application.onCreate. */
        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<ChannelSyncWorker>(6, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request,
            )
        }

        /** Push an immediate refresh (e.g. after sign-in or on foreground). */
        fun refresh(context: Context) {
            val request = OneTimeWorkRequestBuilder<ChannelSyncWorker>()
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                ONESHOT, ExistingWorkPolicy.REPLACE, request,
            )
        }
    }
}
