package com.strata.tv.ui.components

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text

sealed class Loadable<out T> {
    data object Loading : Loadable<Nothing>()
    data class Ready<T>(val value: T) : Loadable<T>()
    data class Error(val cause: Throwable) : Loadable<Nothing>()
}

@Composable
fun <T> loadable(vararg keys: Any?, block: suspend () -> T): State<Loadable<T>> =
    produceState<Loadable<T>>(initialValue = Loadable.Loading, keys = keys) {
        value = try {
            // Jellyfin SDK 1.8+ runs its OkHttp transport synchronously
            // on the caller's dispatcher; default Compose coroutine
            // scope is Main, which trips NetworkOnMainThreadException.
            Loadable.Ready(withContext(Dispatchers.IO) { block() })
        } catch (t: Throwable) {
            Log.e("Strata", "loadable failed", t)
            var cause: Throwable? = t.cause
            var depth = 0
            while (cause != null && depth++ < 5) {
                Log.e("Strata", "  caused by", cause)
                cause = cause.cause
            }
            Loadable.Error(t)
        }
    }

@Composable
fun LoadingCenter(modifier: Modifier = Modifier, label: String = "Loading…") {
    Box(modifier = modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) {
        Text(label, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
fun ErrorCenter(cause: Throwable, modifier: Modifier = Modifier) {
    val full = buildString {
        append(cause::class.simpleName).append(": ").append(cause.message ?: "")
        var c: Throwable? = cause.cause
        var depth = 0
        while (c != null && depth++ < 3) {
            append("\n↳ ").append(c::class.simpleName).append(": ").append(c.message ?: "")
            c = c.cause
        }
    }
    Box(modifier = modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) {
        Text(full, style = MaterialTheme.typography.bodyMedium)
    }
}
