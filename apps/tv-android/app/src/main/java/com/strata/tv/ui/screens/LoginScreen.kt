package com.strata.tv.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.MotifBackdrop
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataMotif
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.StrataType
import com.strata.tv.ui.theme.paletteFor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Editorial two-pane login that mirrors Apple's `LoginView.swift`:
 *   • Left: cycling motif backdrop + STRATA wordmark + tagline
 *   • Right: ACT I overline → Sign in heading → server/username/password
 *     fields → SIGN IN button → HOSTED ON YOUR HARDWARE rule → build footer
 *
 * Quick Connect is intentionally absent here — Apple's tvOS sign-in
 * doesn't expose it. `Repository.quickConnect*` calls are retained so a
 * future "Use Quick Connect" affordance can be added without re-plumbing.
 */
@Composable
fun LoginScreen(onSignedIn: () -> Unit) {
    Row(modifier = Modifier.fillMaxSize().background(StrataColors.Bg)) {
        LoginHero(modifier = Modifier.weight(0.55f).fillMaxHeight())
        LoginForm(
            modifier = Modifier.weight(0.45f).fillMaxHeight(),
            onSignedIn = onSignedIn,
        )
    }
}

// ---------------------------------------------------------------------
// Hero (cycling motif + STRATA wordmark + tagline)
// ---------------------------------------------------------------------

private val heroMotifs = listOf(
    StrataMotif.AURORA,
    StrataMotif.MEGACITY,
    StrataMotif.SUN_HORIZON,
    StrataMotif.CORRIDOR,
    StrataMotif.VAULT,
    StrataMotif.ARCHWAY,
)

@Composable
private fun LoginHero(modifier: Modifier = Modifier) {
    var motifIndex by remember { mutableIntStateOf(0) }
    val palette = remember(motifIndex) { paletteFor("login-$motifIndex") }
    val dateLine = remember {
        SimpleDateFormat("MMM yyyy", Locale.US).format(Date()).uppercase(Locale.US)
    }

    LaunchedEffect(Unit) {
        while (true) {
            delay(7_000)
            motifIndex = (motifIndex + 1) % heroMotifs.size
        }
    }

    Box(modifier = modifier.background(StrataColors.Bg)) {
        // Ambient palette wash behind the motif.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(
                            palette.c1.copy(alpha = 0.45f),
                            palette.c2.copy(alpha = 0.22f),
                            StrataColors.Bg,
                        ),
                    ),
                ),
        )

        // Cycling motif. Cross-fade between motif indexes so the room
        // "breathes" instead of cutting hard between programmes.
        AnimatedContent(
            targetState = motifIndex,
            transitionSpec = {
                fadeIn(animationSpec = tween(1400)) togetherWith
                    fadeOut(animationSpec = tween(1400))
            },
            label = "login-motif",
            modifier = Modifier.fillMaxSize(),
        ) { index ->
            MotifBackdrop(
                motif = heroMotifs[index],
                palette = palette,
                intensity = 0.85f,
                modifier = Modifier.fillMaxSize(),
            )
        }

        // Ink scrim so the wordmark always sits on a darker bed than the motif.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to StrataColors.Bg.copy(alpha = 0.15f),
                        0.55f to StrataColors.Bg.copy(alpha = 0.55f),
                        1f to StrataColors.Bg,
                    ),
                ),
        )

        // Editorial wordmark + tagline, bottom-left.
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 56.dp, bottom = 64.dp, end = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "STRATA",
                color = StrataColors.Paper,
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontSize = 96.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = (-3).sp,
                    lineHeight = 96.sp,
                ),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Tonight's programme,",
                    color = StrataColors.Paper.copy(alpha = 0.7f),
                    style = StrataText.Tagline,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "served warm.",
                    color = StrataColors.Accent2,
                    style = StrataText.Tagline,
                )
            }
        }
    }
}

private fun opusFor(index: Int): String {
    // 3-digit opus number that changes with the rotation, mirroring Apple's
    // `StrataTheme.opus(for: "login")`. Hash-stable, no padding gymnastics.
    val n = (index * 73 + 117) % 899 + 100
    return n.toString()
}

// ---------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------

@Composable
private fun LoginForm(modifier: Modifier = Modifier, onSignedIn: () -> Unit) {
    val authStore = ServiceLocator.authStore
    var serverUrl by remember { mutableStateOf(authStore.serverUrl()) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val serverFocus = remember { FocusRequester() }
    val usernameFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }

    // Auto-focus the first field on mount so the TV remote / host keyboard
    // can type immediately without hunting with the D-pad. The post-frame
    // delay lets BasicTextField wire up its focus modifier before we ask.
    LaunchedEffect(Unit) {
        delay(200)
        runCatching { serverFocus.requestFocus() }
    }

    val canSubmit by remember {
        derivedStateOf {
            !busy &&
                serverUrl.isNotBlank() &&
                (serverUrl.startsWith("http://") || serverUrl.startsWith("https://")) &&
                username.isNotBlank() &&
                password.isNotEmpty()
        }
    }

    fun submit() {
        if (!canSubmit) return
        busy = true
        error = null
        scope.launch {
            try {
                ServiceLocator.repository.signInWithPassword(
                    serverUrl = serverUrl.trim(),
                    username = username.trim(),
                    password = password,
                )
                onSignedIn()
            } catch (t: Throwable) {
                error = t.message ?: "Sign-in failed"
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = modifier
            .padding(horizontal = 56.dp, vertical = 56.dp)
            .widthIn(max = 520.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text(
            text = "Sign in",
            color = StrataColors.Paper,
            style = StrataText.ScreenTitle,
        )
        Text(
            text = "Point Strata at your Jellyfin server and step inside.",
            color = StrataColors.Paper.copy(alpha = 0.62f),
            style = StrataText.MetaDim,
        )

        Spacer(Modifier.height(4.dp))

        EditorialField(
            label = "Server",
            placeholder = "http://192.168.2.162:8096",
            value = serverUrl,
            onValueChange = { serverUrl = it },
            mono = true,
            keyboardType = KeyboardType.Uri,
            imeAction = ImeAction.Next,
            focusRequester = serverFocus,
            onImeAction = { runCatching { usernameFocus.requestFocus() } },
        )
        EditorialField(
            label = "Username",
            placeholder = "you@strata",
            value = username,
            onValueChange = { username = it },
            keyboardType = KeyboardType.Text,
            imeAction = ImeAction.Next,
            focusRequester = usernameFocus,
            onImeAction = { runCatching { passwordFocus.requestFocus() } },
        )
        EditorialField(
            label = "Password",
            placeholder = "••••••",
            value = password,
            onValueChange = { password = it },
            isSecure = true,
            keyboardType = KeyboardType.Password,
            imeAction = ImeAction.Done,
            focusRequester = passwordFocus,
            onImeAction = { submit() },
        )

        if (error != null) {
            ErrorBanner(message = error.orEmpty())
        }

        SignInButton(
            isBusy = busy,
            enabled = canSubmit,
            onClick = { submit() },
        )
    }
}

// ---------------------------------------------------------------------
// Editorial text field — focus-driven border + label + mono/plex split
// ---------------------------------------------------------------------

@Composable
private fun EditorialField(
    label: String,
    placeholder: String,
    value: String,
    onValueChange: (String) -> Unit,
    mono: Boolean = false,
    isSecure: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    focusRequester: FocusRequester? = null,
    onImeAction: (() -> Unit)? = null,
) {
    var focused by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current

    // On Android TV the system IME doesn't always pop up just because a text
    // field is focused — calling `show()` from a `LaunchedEffect(focused)`
    // forces it. Costs nothing on phones (the OS already showed it).
    LaunchedEffect(focused) {
        if (focused) runCatching { keyboard?.show() }
    }

    val textStyle = TextStyle(
        fontFamily = if (mono) StrataType.Mono else StrataType.Plex,
        color = StrataColors.Paper,
        fontSize = 20.sp,
        letterSpacing = if (mono) 0.5.sp else 0.sp,
    )

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(text = label, color = StrataColors.Paper.copy(alpha = 0.7f), style = StrataText.Chip)
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = textStyle,
            placeholder = {
                Text(
                    text = placeholder,
                    color = StrataColors.Paper.copy(alpha = 0.32f),
                    style = textStyle,
                )
            },
            visualTransformation = if (isSecure) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = keyboardType,
                imeAction = imeAction,
                autoCorrect = false,
            ),
            keyboardActions = KeyboardActions(
                onNext = { onImeAction?.invoke() },
                onDone = { onImeAction?.invoke() },
                onGo = { onImeAction?.invoke() },
            ),
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = StrataColors.Paper,
                unfocusedTextColor = StrataColors.Paper,
                cursorColor = StrataColors.Accent,
                focusedBorderColor = StrataColors.Accent2,
                unfocusedBorderColor = StrataColors.Paper.copy(alpha = 0.18f),
                focusedContainerColor = StrataColors.Paper.copy(alpha = 0.06f),
                unfocusedContainerColor = StrataColors.Paper.copy(alpha = 0.03f),
                focusedPlaceholderColor = StrataColors.Paper.copy(alpha = 0.45f),
                unfocusedPlaceholderColor = StrataColors.Paper.copy(alpha = 0.32f),
            ),
            modifier = Modifier
                .fillMaxWidth()
                .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
                .onFocusChanged { focused = it.isFocused },
        )
    }
}

// ---------------------------------------------------------------------
// Sign-in button + error banner
// ---------------------------------------------------------------------

@Composable
private fun SignInButton(
    isBusy: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.03f else 1f, label = "signin-scale")
    val interaction = remember { MutableInteractionSource() }

    val active = enabled && !isBusy
    val bg = when {
        focused && active -> Color.White
        active -> StrataColors.Paper
        else -> StrataColors.Paper.copy(alpha = 0.32f)
    }
    val fg = if (active) StrataColors.Ink else StrataColors.Ink.copy(alpha = 0.55f)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .scale(scale)
            .clip(RoundedCornerShape(10.dp))
            .background(bg)
            .onFocusChanged { focused = it.isFocused }
            .clickable(
                enabled = active,
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = if (isBusy) "Signing in…" else "Sign in",
                color = fg,
                style = StrataText.Button,
            )
            Spacer(Modifier.weight(1f))
            Text(text = if (isBusy) "…" else "→", color = fg, style = StrataText.Button)
        }
    }
}

@Composable
private fun ErrorBanner(message: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(2.dp))
            .background(StrataColors.Accent.copy(alpha = 0.10f))
            .border(width = 1.dp, color = StrataColors.Accent.copy(alpha = 0.4f), shape = RoundedCornerShape(2.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .wrapContentHeight(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = "Sign-in failed",
            color = StrataColors.Accent,
            style = StrataText.Meta,
        )
        Text(
            text = message,
            color = StrataColors.Paper.copy(alpha = 0.85f),
            style = TextStyle(
                fontFamily = StrataType.Plex,
                fontSize = 13.sp,
                lineHeight = 18.sp,
            ),
        )
    }
}
