package com.strata.tv.ui.screens.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import kotlinx.coroutines.delay

/**
 * Quick Connect flow: initiate → poll every 2 s for up to 5 minutes →
 * authenticateWithQuickConnect on approval. Mirrors the
 * `getQuickConnectApi(api).initiate / connect` pattern used by the
 * Jellyfin reference Android TV client.
 */
@Composable
fun QuickConnectPanel(onSignedIn: () -> Unit) {
    val repo = ServiceLocator.repository
    var code by remember { mutableStateOf<String?>(null) }
    var secret by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf("Starting…") }

    LaunchedEffect(Unit) {
        try {
            val res = repo.quickConnectInitiate()
            code = res.code
            secret = res.secret
            status = "Approve at ${repo.serverUrl}/quickconnect"
        } catch (t: Throwable) {
            error = t.message ?: "Could not start Quick Connect"
        }
    }

    LaunchedEffect(secret) {
        val s = secret ?: return@LaunchedEffect
        val deadline = System.currentTimeMillis() + 5 * 60 * 1000
        while (System.currentTimeMillis() < deadline) {
            try {
                val res = repo.quickConnectPoll(s)
                if (res.authenticated) {
                    repo.authenticateWithQuickConnect(s)
                    onSignedIn()
                    return@LaunchedEffect
                }
            } catch (_: Throwable) {
                // transient — keep polling
            }
            delay(2_000)
        }
        error = "Code expired. Try again."
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(StrataColors.Bg2)
            .padding(40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = code ?: "------",
            color = StrataColors.Accent,
            style = MaterialTheme.typography.displayLarge,
        )
        Text(
            text = error ?: status,
            color = StrataColors.Paper.copy(alpha = 0.7f),
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}
