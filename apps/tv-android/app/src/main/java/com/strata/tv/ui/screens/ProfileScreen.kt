package com.strata.tv.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.data.Account
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataType
import java.util.Locale

/**
 * "Who's watching?" profile chooser — the Android mirror of Apple's
 * `ProfileGateView`. Serves as both the launch gate (shown when more than one
 * profile is saved) and an in-app switcher (reached from the masthead menu).
 * Selecting a profile swaps the active token with no re-auth.
 */
@Composable
fun ProfileScreen(nav: NavController) {
    val accounts by ServiceLocator.repository.accounts.collectAsState()
    val session by ServiceLocator.authStore.session.collectAsState()
    val firstFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        runCatching { firstFocus.requestFocus() }
    }

    Box(
        modifier = Modifier.fillMaxSize().background(StrataColors.Bg),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(48.dp),
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "STRATA",
                    color = StrataColors.Paper.copy(alpha = 0.55f),
                    style = TextStyle(
                        fontFamily = StrataType.Mono,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 3.2.sp,
                    ),
                )
                Text(
                    text = "Who's watching?",
                    color = StrataColors.Paper,
                    style = TextStyle(
                        fontFamily = StrataType.Fraunces,
                        fontSize = 52.sp,
                        fontWeight = FontWeight.Medium,
                        letterSpacing = (-1.4).sp,
                    ),
                )
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(40.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.Top,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 60.dp),
            ) {
                accounts.forEachIndexed { index, account ->
                    ProfileTile(
                        account = account,
                        isActive = account.userId == session?.userId,
                        focusRequester = if (index == 0) firstFocus else null,
                        onSelect = {
                            ServiceLocator.repository.switchAccount(account.userId)
                            nav.navigate(Routes.Home) {
                                popUpTo(Routes.Profiles) { inclusive = true }
                                launchSingleTop = true
                            }
                        },
                    )
                }
                AddProfileTile(
                    onSelect = { nav.navigate(Routes.Login) },
                )
            }
        }
    }
}

@Composable
private fun ProfileTile(
    account: Account,
    isActive: Boolean,
    focusRequester: FocusRequester?,
    onSelect: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.08f else 1f, label = "profile-scale")
    val interaction = remember { MutableInteractionSource() }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier
            .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onSelect),
    ) {
        Box(
            modifier = Modifier
                .size(150.dp)
                .scale(scale)
                .clip(CircleShape)
                .border(
                    width = if (focused) 4.dp else if (isActive) 2.dp else 0.dp,
                    color = when {
                        focused -> StrataColors.Paper
                        isActive -> StrataColors.Accent2
                        else -> Color.Transparent
                    },
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier.fillMaxSize().background(StrataColors.Accent.copy(alpha = 0.35f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = initials(account.userName),
                    color = StrataColors.Paper,
                    style = TextStyle(
                        fontFamily = StrataType.Fraunces,
                        fontSize = 56.sp,
                        fontWeight = FontWeight.Medium,
                    ),
                )
            }
            AsyncImage(
                model = ServiceLocator.repository.imageUrls.userAvatar(account, maxWidth = 320),
                contentDescription = account.userName,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Text(
            text = account.userName.ifBlank { "User" },
            color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.6f),
            style = TextStyle(
                fontFamily = StrataType.Plex,
                fontSize = 22.sp,
                fontWeight = if (focused) FontWeight.SemiBold else FontWeight.Normal,
            ),
        )
    }
}

@Composable
private fun AddProfileTile(onSelect: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.08f else 1f, label = "add-scale")
    val interaction = remember { MutableInteractionSource() }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onSelect),
    ) {
        Box(
            modifier = Modifier
                .size(150.dp)
                .scale(scale)
                .clip(CircleShape)
                .background(StrataColors.Paper.copy(alpha = 0.06f))
                .border(
                    width = if (focused) 4.dp else 1.dp,
                    color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.18f),
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "+",
                color = StrataColors.Paper.copy(alpha = 0.7f),
                style = TextStyle(fontFamily = StrataType.Mono, fontSize = 56.sp, fontWeight = FontWeight.Light),
            )
        }
        Text(
            text = "Add Profile",
            color = StrataColors.Paper.copy(alpha = 0.6f),
            style = TextStyle(fontFamily = StrataType.Plex, fontSize = 22.sp),
        )
    }
}

private fun initials(name: String): String {
    val parts = name.trim().split(" ").filter { it.isNotEmpty() }
    val letters = parts.take(2).mapNotNull { it.firstOrNull() }
    return if (letters.isEmpty()) "?" else letters.joinToString("").uppercase(Locale.US)
}
