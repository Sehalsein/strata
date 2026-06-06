package com.strata.tv.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Mirrors Apple's `AuthStore.swift` multi-account model. Each profile is a
 * real Jellyfin user with its own token; switching swaps the active token.
 * Account identity is the Jellyfin `userId` (a server-assigned GUID), stable
 * across server-address changes.
 *
 * The accounts list (token included) lives in an EncryptedSharedPreferences
 * file; device id and the active server URL live in plain SharedPreferences —
 * neither is a secret.
 */
class AuthStore(context: Context, private val defaultServerUrl: String) {
    private val secure: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        SECURE_FILE,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    private val plain: SharedPreferences =
        context.getSharedPreferences(PLAIN_FILE, Context.MODE_PRIVATE)

    init {
        migrateLegacyIfNeeded()
    }

    private val _accounts = MutableStateFlow(readAccounts())
    /** All saved profiles, for the "Who's watching?" chooser. */
    val accounts: StateFlow<List<Account>> = _accounts.asStateFlow()

    private val _session = MutableStateFlow(readActive()?.let { Session(it.userId, it.userName) })
    val session: StateFlow<Session?> = _session.asStateFlow()

    fun deviceId(): String {
        plain.getString(KEY_DEVICE_ID, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        plain.edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    /** Currently-targeted Jellyfin server. Defaults to the build-time URL. */
    fun serverUrl(): String = plain.getString(KEY_SERVER_URL, null) ?: defaultServerUrl

    fun persistServerUrl(url: String) {
        plain.edit().putString(KEY_SERVER_URL, url).apply()
    }

    // Active-account accessors — read straight off the active profile so every
    // ApiClient / ImageUrls call follows the current selection.
    private fun activeId(): String? = plain.getString(KEY_ACTIVE_USER_ID, null)
    private fun readActive(): Account? {
        val id = activeId() ?: return null
        val accounts = _accountsOrRead()
        return accounts.firstOrNull { it.userId == id } ?: accounts.firstOrNull()
    }

    fun accessToken(): String? = readActive()?.token
    fun userId(): String? = readActive()?.userId
    fun userName(): String? = readActive()?.userName
    fun hasSession(): Boolean = readActive() != null

    /**
     * Add the account (or refresh it in place) and make it active. Called both
     * for first sign-in and "Add Profile". The server URL is whatever
     * `serverUrl()` currently points at (Repository persists it before auth).
     */
    fun persistAuth(token: String, userId: String, userName: String?) {
        val account = Account(serverUrl(), userId, userName.orEmpty(), token)
        val next = readAccounts().filterNot { it.userId == userId } + account
        writeAccounts(next)
        setActive(account)
    }

    /** Switch the active profile to a saved account — no network, no password. */
    fun switchAccount(userId: String) {
        val account = readAccounts().firstOrNull { it.userId == userId } ?: return
        setActive(account)
    }

    /**
     * Remove a profile and its token. If the active profile is removed, falls
     * back to another; if none remain, signs out entirely.
     */
    fun removeAccount(userId: String) {
        val remaining = readAccounts().filterNot { it.userId == userId }
        writeAccounts(remaining)
        if (activeId() == userId) {
            val next = remaining.firstOrNull()
            if (next != null) setActive(next) else clearActive()
        }
    }

    /** Sign out of the *active* profile only (other profiles stay signed in). */
    fun clear() {
        val id = activeId()
        if (id != null) removeAccount(id) else clearActive()
    }

    private fun setActive(account: Account) {
        plain.edit()
            .putString(KEY_ACTIVE_USER_ID, account.userId)
            .putString(KEY_SERVER_URL, account.serverUrl)
            .apply()
        _session.value = Session(account.userId, account.userName)
    }

    private fun clearActive() {
        plain.edit().remove(KEY_ACTIVE_USER_ID).apply()
        _session.value = null
    }

    // ---------------------------------------------------------------------
    // Persistence (accounts as a JSON array in the encrypted file)
    // ---------------------------------------------------------------------

    private fun _accountsOrRead(): List<Account> = _accounts.value

    private fun readAccounts(): List<Account> {
        val raw = secure.getString(KEY_ACCOUNTS, null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Account(
                    serverUrl = o.getString("serverUrl"),
                    userId = o.getString("userId"),
                    userName = o.optString("userName", ""),
                    token = o.getString("token"),
                )
            }
        }.getOrDefault(emptyList())
    }

    private fun writeAccounts(accounts: List<Account>) {
        val arr = JSONArray()
        accounts.forEach { a ->
            arr.put(
                JSONObject()
                    .put("serverUrl", a.serverUrl)
                    .put("userId", a.userId)
                    .put("userName", a.userName)
                    .put("token", a.token),
            )
        }
        secure.edit().putString(KEY_ACCOUNTS, arr.toString()).apply()
        _accounts.value = accounts
    }

    /**
     * One-time migration from the pre-profiles layout: a single token/userId/
     * userName stored under flat keys. Folds it into the accounts list and
     * marks it active.
     */
    private fun migrateLegacyIfNeeded() {
        if (secure.getString(KEY_ACCOUNTS, null) != null) return
        val token = secure.getString(LEGACY_KEY_TOKEN, null) ?: return
        val userId = secure.getString(LEGACY_KEY_USER_ID, null) ?: return
        val userName = secure.getString(LEGACY_KEY_USER_NAME, null).orEmpty()
        val server = plain.getString(KEY_SERVER_URL, null) ?: defaultServerUrl
        val arr = JSONArray().put(
            JSONObject()
                .put("serverUrl", server)
                .put("userId", userId)
                .put("userName", userName)
                .put("token", token),
        )
        secure.edit()
            .putString(KEY_ACCOUNTS, arr.toString())
            .remove(LEGACY_KEY_TOKEN)
            .remove(LEGACY_KEY_USER_ID)
            .remove(LEGACY_KEY_USER_NAME)
            .apply()
        plain.edit().putString(KEY_ACTIVE_USER_ID, userId).apply()
    }

    companion object {
        private const val SECURE_FILE = "strata-secure"
        private const val PLAIN_FILE = "strata-prefs"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_ACTIVE_USER_ID = "active_user_id"
        private const val KEY_ACCOUNTS = "accounts"
        // Legacy single-account keys, read once for migration.
        private const val LEGACY_KEY_TOKEN = "access_token"
        private const val LEGACY_KEY_USER_ID = "user_id"
        private const val LEGACY_KEY_USER_NAME = "user_name"
    }
}

/** A saved profile: a Jellyfin user with its own token and home server. */
data class Account(
    val serverUrl: String,
    val userId: String,
    val userName: String,
    val token: String,
)

data class Session(val userId: String, val userName: String)
