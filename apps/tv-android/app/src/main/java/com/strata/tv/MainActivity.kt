package com.strata.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import com.strata.tv.ui.nav.StrataNavHost
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            StrataTheme {
                StrataNavHost(modifier = Modifier.fillMaxSize().background(StrataColors.Bg))
            }
        }
    }
}
