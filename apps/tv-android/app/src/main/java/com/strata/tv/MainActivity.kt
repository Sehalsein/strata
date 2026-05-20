package com.strata.tv

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.nav.StrataNavHost
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Cold start: forward the launching VIEW intent (if any) to the bus
        // before the nav host subscribes — `replay = 1` means it still
        // arrives once StrataNavHost's collector attaches.
        ServiceLocator.deepLinks.submit(intent?.data)

        setContent {
            StrataTheme {
                StrataNavHost(modifier = Modifier.fillMaxSize().background(StrataColors.Bg))
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // singleTask launchMode means VIEW intents arriving while we're
        // already running come through here, not onCreate.
        ServiceLocator.deepLinks.submit(intent.data)
    }
}
