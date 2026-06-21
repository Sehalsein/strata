package com.strata.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.material3.Text
import com.strata.tv.data.Prefs
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.SecondaryButton
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText

/**
 * Settings panel. Sectioned single-column rows in a right-aligned column,
 * matching Jellyfin's new Compose settings. Each row cycles through its options
 * on click (D-pad-friendly) and writes straight to [Prefs], which the player
 * path reads at stream-build time.
 */
@Composable
fun SettingsScreen(nav: NavController) {
    val prefs = ServiceLocator.prefs
    val state by prefs.state.collectAsState()

    TvLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 96.dp, end = 64.dp, top = 120.dp, bottom = 64.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        item(key = "title") {
            Text(text = "Settings", color = StrataColors.Paper, style = StrataText.ScreenTitle)
        }

        item(key = "playback") {
            SettingsSection("Playback") {
                val bitrateIdx = Prefs.BITRATE_OPTIONS.indexOfFirst { it.second == state.maxBitrateMbps }
                    .coerceAtLeast(0)
                SettingRow(
                    label = "Max streaming quality",
                    value = Prefs.BITRATE_OPTIONS[bitrateIdx].first,
                    onCycle = {
                        val next = Prefs.BITRATE_OPTIONS[(bitrateIdx + 1) % Prefs.BITRATE_OPTIONS.size]
                        prefs.setMaxBitrateMbps(next.second)
                    },
                )
                SettingRow(
                    label = "Force transcode",
                    value = if (state.forceTranscode) "On" else "Off",
                    onCycle = { prefs.setForceTranscode(!state.forceTranscode) },
                )
            }
        }

        item(key = "language") {
            SettingsSection("Language") {
                val audioIdx = Prefs.LANGUAGE_OPTIONS.indexOfFirst { it.second == state.audioLang }
                    .coerceAtLeast(0)
                SettingRow(
                    label = "Preferred audio",
                    value = Prefs.LANGUAGE_OPTIONS[audioIdx].first,
                    onCycle = {
                        val next = Prefs.LANGUAGE_OPTIONS[(audioIdx + 1) % Prefs.LANGUAGE_OPTIONS.size]
                        prefs.setAudioLang(next.second)
                    },
                )
                val subIdx = Prefs.LANGUAGE_OPTIONS.indexOfFirst { it.second == state.subtitleLang }
                    .coerceAtLeast(0)
                SettingRow(
                    label = "Preferred subtitles",
                    value = Prefs.LANGUAGE_OPTIONS[subIdx].first,
                    onCycle = {
                        val next = Prefs.LANGUAGE_OPTIONS[(subIdx + 1) % Prefs.LANGUAGE_OPTIONS.size]
                        prefs.setSubtitleLang(next.second)
                    },
                )
            }
        }

        item(key = "account") {
            SettingsSection("Account") {
                SecondaryButton(
                    label = "Switch profile",
                    onClick = { nav.navigate(Routes.Profiles) },
                )
                SecondaryButton(
                    label = "Sign out",
                    onClick = { ServiceLocator.repository.signOut() },
                )
            }
        }
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.widthIn(max = 560.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(text = title, color = StrataColors.Paper.copy(alpha = 0.7f), style = StrataText.SectionTitle)
        content()
    }
}

/** A label + a focusable value button that cycles through options on click. */
@Composable
private fun SettingRow(label: String, value: String, onCycle: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = label,
            color = StrataColors.Paper.copy(alpha = 0.85f),
            style = StrataText.Meta,
            modifier = Modifier.width(280.dp),
        )
        Spacer(Modifier.width(16.dp))
        SecondaryButton(label = value, onClick = onCycle)
    }
}
