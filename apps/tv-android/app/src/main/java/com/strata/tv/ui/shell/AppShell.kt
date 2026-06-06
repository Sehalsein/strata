package com.strata.tv.ui.shell

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.tv.material3.Text
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.StrataType
import com.strata.tv.ui.theme.titleAmbience

/** App chrome: a floating top bar over a full-bleed content area. */
@Composable
fun AppShell(nav: NavController, content: @Composable () -> Unit) {
    val palette = LocalStrataPalette.current
    Box(modifier = Modifier.fillMaxSize().titleAmbience(palette)) {
        // Content bleeds to every edge so the home hero is a true full-screen
        // billboard. The bar floats on top of it (Apple-TV style) rather than
        // stealing a 56dp band off the top.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .focusRestorer(),
        ) {
            content()
        }
        // Floating top bar: a scrim keeps the wordmark/tabs legible over bright
        // artwork, and the top inset keeps them clear of TV overscan. Its own
        // focus group so D-pad Left/Right stays on the tabs and Down drops into
        // the content.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopStart)
                .background(
                    Brush.verticalGradient(
                        0f to StrataColors.Bg.copy(alpha = 0.80f),
                        1f to Color.Transparent,
                    ),
                )
                .focusGroup(),
        ) {
            TopBar(nav)
        }
    }
}

private data class NavTabSpec(val route: String, val label: String, val matches: (String) -> Boolean)

private val tabs = listOf(
    NavTabSpec(Routes.Home, "Home") { it == Routes.Home },
    NavTabSpec(Routes.Movies, "Movies") { it.startsWith("movies") },
    NavTabSpec(Routes.Shows, "Shows") { it.startsWith("shows") },
    NavTabSpec(Routes.Search, "Search") { it.startsWith("search") },
)

@Composable
private fun TopBar(nav: NavController) {
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route ?: Routes.Home

    Row(
        modifier = Modifier
            .fillMaxWidth()
            // top inset clears TV overscan; generous bottom padding lets the
            // scrim fade out below the tabs.
            .padding(start = 48.dp, end = 48.dp, top = 24.dp, bottom = 22.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = "STRATA", color = StrataColors.Paper, style = StrataText.Wordmark)
        Spacer(Modifier.width(32.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            tabs.forEach { spec ->
                NavTab(spec.label, isActive = spec.matches(route)) {
                    nav.navigate(spec.route) {
                        launchSingleTop = true
                        popUpTo(Routes.Home)
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        UserBadge(nav)
    }
}

@Composable
private fun NavTab(label: String, isActive: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "tab-scale")
    val interaction = remember { MutableInteractionSource() }
    val bg = when {
        focused -> StrataColors.Paper
        isActive -> StrataColors.Paper.copy(alpha = 0.14f)
        else -> Color.Transparent
    }
    val fg = when {
        focused -> StrataColors.Ink
        isActive -> StrataColors.Paper
        else -> StrataColors.Paper.copy(alpha = 0.55f)
    }
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Text(text = label, color = fg, style = StrataText.TabLabel)
    }
}

@Composable
private fun UserBadge(nav: NavController) {
    val session by ServiceLocator.authStore.session.collectAsState()
    val displayName = session?.userName?.takeIf { it.isNotBlank() } ?: "Guest"
    val initial = displayName.first().uppercaseChar().toString()

    var focused by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.08f else 1f, label = "badge-scale")
    val interaction = remember { MutableInteractionSource() }

    Box {
        Box(
            modifier = Modifier
                .scale(scale)
                .size(34.dp)
                .clip(CircleShape)
                .background(StrataColors.Accent)
                .border(
                    width = if (focused) 2.dp else 0.dp,
                    color = if (focused) StrataColors.Accent2 else Color.Transparent,
                    shape = CircleShape,
                )
                .onFocusChanged { focused = it.isFocused }
                .clickable(interactionSource = interaction, indication = null, onClick = { menuOpen = true }),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = initial,
                color = StrataColors.Paper,
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
        }

        if (menuOpen) {
            UserMenu(
                onDismiss = { menuOpen = false },
                onMyList = {
                    menuOpen = false
                    nav.navigate(Routes.MyList)
                },
                onSwitchProfile = {
                    menuOpen = false
                    nav.navigate(Routes.Profiles)
                },
                onSignOut = {
                    menuOpen = false
                    ServiceLocator.repository.signOut()
                },
            )
        }
    }
}

@Composable
private fun UserMenu(
    onDismiss: () -> Unit,
    onMyList: () -> Unit,
    onSwitchProfile: () -> Unit,
    onSignOut: () -> Unit,
) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    androidx.compose.ui.window.Popup(
        alignment = Alignment.TopEnd,
        offset = androidx.compose.ui.unit.IntOffset(0, 48),
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.PopupProperties(focusable = true),
    ) {
        Column(
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(StrataColors.Bg2)
                .padding(horizontal = 6.dp, vertical = 8.dp),
        ) {
            UserMenuItem("My List", focusRequester = focusRequester, onClick = onMyList)
            UserMenuItem("Switch profile", onClick = onSwitchProfile)
            UserMenuItem("Sign out", onClick = onSignOut)
        }
    }
}

@Composable
private fun UserMenuItem(
    text: String,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
            .clip(RoundedCornerShape(8.dp))
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.12f) else Color.Transparent)
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Text(
            text = text,
            color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.75f),
            style = StrataText.Chip,
        )
    }
}
