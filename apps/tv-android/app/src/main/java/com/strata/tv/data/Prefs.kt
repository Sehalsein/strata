package com.strata.tv.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Playback preferences. Plain (non-secret) SharedPreferences, mirroring
 * [AuthStore]'s storage style. Exposes a [StateFlow] the settings screen
 * observes plus synchronous getters the player path reads at stream-build time.
 */
class Prefs(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(read())
    val state: StateFlow<PrefsState> = _state.asStateFlow()

    private fun read() = PrefsState(
        maxBitrateMbps = prefs.getInt(KEY_BITRATE, 0),
        audioLang = prefs.getString(KEY_AUDIO, null),
        subtitleLang = prefs.getString(KEY_SUBS, null),
        forceTranscode = prefs.getBoolean(KEY_FORCE_TRANSCODE, false),
    )

    private fun mutate(block: SharedPreferences.Editor.() -> Unit) {
        prefs.edit().apply(block).apply()
        _state.value = read()
    }

    fun setMaxBitrateMbps(mbps: Int) = mutate { putInt(KEY_BITRATE, mbps) }
    fun setAudioLang(code: String?) = mutate {
        if (code == null) remove(KEY_AUDIO) else putString(KEY_AUDIO, code)
    }
    fun setSubtitleLang(code: String?) = mutate {
        if (code == null) remove(KEY_SUBS) else putString(KEY_SUBS, code)
    }
    fun setForceTranscode(on: Boolean) = mutate { putBoolean(KEY_FORCE_TRANSCODE, on) }

    // --- synchronous reads for the player path ---

    /** Per-request streaming ceiling in bits/sec. 0 (Auto) → the device default. */
    fun maxStreamingBitrate(): Int {
        val mbps = _state.value.maxBitrateMbps
        return if (mbps <= 0) DEFAULT_BITRATE else mbps * 1_000_000
    }

    fun forceTranscode(): Boolean = _state.value.forceTranscode
    fun preferredAudioLang(): String? = _state.value.audioLang
    fun preferredSubtitleLang(): String? = _state.value.subtitleLang

    companion object {
        private const val FILE = "strata_prefs"
        private const val KEY_BITRATE = "max_bitrate_mbps"
        private const val KEY_AUDIO = "audio_lang"
        private const val KEY_SUBS = "subtitle_lang"
        private const val KEY_FORCE_TRANSCODE = "force_transcode"

        /** Matches the prior hardcoded `StreamPlanner` ceiling. */
        const val DEFAULT_BITRATE = 120_000_000

        /** Bitrate menu: label → Mbps (0 = Auto). */
        val BITRATE_OPTIONS = listOf(
            "Auto" to 0, "40 Mbps" to 40, "20 Mbps" to 20, "10 Mbps" to 10, "4 Mbps" to 4,
        )

        /** Language menu: label → ISO-639-2 code (null = Auto). */
        val LANGUAGE_OPTIONS = listOf(
            "Auto" to null, "English" to "eng", "Spanish" to "spa",
            "French" to "fra", "German" to "deu", "Japanese" to "jpn",
        )
    }
}

data class PrefsState(
    val maxBitrateMbps: Int,
    val audioLang: String?,
    val subtitleLang: String?,
    val forceTranscode: Boolean,
)
