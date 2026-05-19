package com.strata.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.screens.login.PasswordPanel
import com.strata.tv.ui.screens.login.QuickConnectPanel
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.titleAmbience
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(onSignedIn: () -> Unit) {
    var usePassword by remember { mutableStateOf(false) }
    val palette = LocalStrataPalette.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .titleAmbience(palette),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier.width(720.dp),
        ) {
            Text(
                "Strata",
                style = MaterialTheme.typography.displayMedium,
                color = StrataColors.Paper,
            )
            Text(
                "Sign in to your Jellyfin server",
                style = MaterialTheme.typography.titleMedium,
                color = StrataColors.Paper.copy(alpha = 0.7f),
            )

            if (!usePassword) {
                QuickConnectPanel(onSignedIn = onSignedIn)
                TextButton("Use password instead") { usePassword = true }
            } else {
                PasswordPanel(onSignedIn = onSignedIn)
                TextButton("Use Quick Connect instead") { usePassword = false }
            }
        }
    }
}

@Composable
fun TextButton(label: String, onClick: () -> Unit) {
    Button(onClick = onClick) {
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}
