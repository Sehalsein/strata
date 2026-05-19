package com.strata.tv.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

/**
 * Mirrors `apps/web/src/lib/api.ts:55-99` (`getOrCreateDeviceId`,
 * `persistAuth`, `clearAuth`, `getUserId/Name/AccessToken`). Token +
 * user id live in an EncryptedSharedPreferences file; device id lives
 * in a plain SharedPreferences file because losing it just rotates the
 * Jellyfin device identifier — not a secret.
 */
class AuthStore(context: Context) {
    private val secure: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        SECURE_FILE,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    private val plain: SharedPreferences =
        context.getSharedPreferences(PLAIN_FILE, Context.MODE_PRIVATE)

    private val _session = MutableStateFlow(readSession())
    val session: StateFlow<Session?> = _session.asStateFlow()

    fun deviceId(): String {
        plain.getString(KEY_DEVICE_ID, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        plain.edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    fun accessToken(): String? = secure.getString(KEY_TOKEN, null)
    fun userId(): String? = secure.getString(KEY_USER_ID, null)
    fun userName(): String? = secure.getString(KEY_USER_NAME, null)
    fun hasSession(): Boolean = accessToken() != null && userId() != null

    fun persistAuth(token: String, userId: String, userName: String?) {
        secure.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USER_ID, userId)
            .putString(KEY_USER_NAME, userName.orEmpty())
            .apply()
        _session.value = Session(userId, userName.orEmpty())
    }

    fun clear() {
        secure.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_ID)
            .remove(KEY_USER_NAME)
            .apply()
        _session.value = null
    }

    private fun readSession(): Session? {
        val id = userId() ?: return null
        return Session(id, userName().orEmpty())
    }

    companion object {
        private const val SECURE_FILE = "strata-secure"
        private const val PLAIN_FILE = "strata-prefs"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_TOKEN = "access_token"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USER_NAME = "user_name"
    }
}

data class Session(val userId: String, val userName: String)
