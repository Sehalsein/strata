package com.strata.tv.ui.shell

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.tv.material3.Text
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.titleAmbience
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Editorial Strata shell: spec strip, numbered nav masthead, colophon. */
@Composable
fun AppShell(nav: NavController, content: @Composable () -> Unit) {
    val palette = LocalStrataPalette.current
    Box(modifier = Modifier.fillMaxSize().titleAmbience(palette)) {
        Column(modifier = Modifier.fillMaxSize()) {
            SpecStrip()
            Masthead(nav)
            Box(modifier = Modifier.weight(1f).fillMaxWidth()) { content() }
            Colophon()
        }
    }
}

@Composable
private fun SpecStrip() {
    val today = remember {
        SimpleDateFormat("MMM dd · yyyy", Locale.US).format(Date()).uppercase()
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 48.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(StrataColors.Accent),
            )
            Spacer(Modifier.width(10.dp))
            SpecText("On Air", alpha = 0.7f)
            SpecDot()
            SpecText("Vol. III")
        }
        Spacer(Modifier.weight(1f))
        SpecText(today, alpha = 0.7f)
        Spacer(Modifier.weight(1f))
        SpecText("Est. MMXXVI", alpha = 0.35f)
        SpecDot()
        SpecText("Strata Cinemathèque", alpha = 0.7f)
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(StrataColors.Paper.copy(alpha = 0.1f)),
    )
}

@Composable
private fun SpecText(text: String, alpha: Float = 0.55f) {
    Text(
        text = text.uppercase(),
        color = StrataColors.Paper.copy(alpha = alpha),
        style = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            letterSpacing = 2.4.sp,
        ),
    )
}

@Composable
private fun SpecDot() {
    Spacer(Modifier.width(10.dp))
    Text(
        text = "·",
        color = StrataColors.Paper.copy(alpha = 0.3f),
        style = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
        ),
    )
    Spacer(Modifier.width(10.dp))
}

private data class NavTabSpec(val route: String, val label: String, val num: String, val matches: (String) -> Boolean)

private val tabs = listOf(
    NavTabSpec(Routes.Home, "Index", "00") { it == Routes.Home },
    NavTabSpec(Routes.Movies, "Films", "01") { it.startsWith("movies") },
    NavTabSpec(Routes.Shows, "Series", "02") { it.startsWith("shows") },
    NavTabSpec(Routes.Search, "Search", "03") { it.startsWith("search") },
)

@Composable
private fun Masthead(nav: NavController) {
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route ?: Routes.Home

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 48.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = "Strata",
                color = StrataColors.Paper,
                style = TextStyle(
                    fontFamily = FontFamily.Serif,
                    fontSize = 36.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = (-1.2).sp,
                ),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = "№ 00.01",
                color = StrataColors.Paper.copy(alpha = 0.4f),
                modifier = Modifier.padding(bottom = 8.dp),
                style = TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    letterSpacing = 2.4.sp,
                ),
            )
        }
        Spacer(Modifier.width(20.dp))
        Box(
            Modifier
                .width(1.dp)
                .height(24.dp)
                .background(StrataColors.Paper.copy(alpha = 0.15f)),
        )
        Spacer(Modifier.width(20.dp))
        tabs.forEach { spec ->
            NavTab(spec, isActive = spec.matches(route)) {
                nav.navigate(spec.route) {
                    launchSingleTop = true
                    popUpTo(Routes.Home)
                }
            }
        }
        Spacer(Modifier.weight(1f))
        UserBadge()
    }
}

@Composable
private fun NavTab(spec: NavTabSpec, isActive: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val color = when {
        isActive || focused -> StrataColors.Paper
        else -> StrataColors.Paper.copy(alpha = 0.45f)
    }
    val numColor = StrataColors.Paper.copy(alpha = if (focused) 0.7f else 0.35f)
    val interaction = remember { MutableInteractionSource() }

    Column(
        modifier = Modifier
            .padding(horizontal = 14.dp, vertical = 4.dp)
            .onFocusChanged { focused = it.isFocused }
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = spec.num,
                color = numColor,
                modifier = Modifier.padding(end = 8.dp, bottom = 4.dp),
                style = TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    letterSpacing = 1.8.sp,
                ),
            )
            Text(
                text = spec.label,
                color = color,
                style = TextStyle(
                    fontFamily = FontFamily.Serif,
                    fontSize = 19.sp,
                    fontStyle = if (isActive) FontStyle.Italic else FontStyle.Normal,
                ),
            )
        }
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier
                .width(if (isActive || focused) 38.dp else 0.dp)
                .height(2.dp)
                .background(if (isActive) StrataColors.Accent else StrataColors.Paper.copy(alpha = 0.5f)),
        )
    }
}

@Composable
private fun UserBadge() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .background(StrataColors.Accent),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "S",
                color = StrataColors.Paper,
                style = TextStyle(
                    fontFamily = FontFamily.Serif,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
        }
        Spacer(Modifier.width(10.dp))
        Text(
            text = "SEHAL",
            color = StrataColors.Paper.copy(alpha = 0.55f),
            maxLines = 1,
            softWrap = false,
            style = TextStyle(
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                letterSpacing = 1.8.sp,
            ),
        )
    }
}

@Composable
private fun Colophon() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(StrataColors.Paper.copy(alpha = 0.08f)),
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 48.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SpecText("A private repertory", alpha = 0.3f)
        SpecDot()
        SpecText("est. MMXXVI", alpha = 0.3f)
        SpecDot()
        SpecText("printed in the dark", alpha = 0.3f)
    }
}
