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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.ErrorCenter
import com.strata.tv.ui.components.Loadable
import com.strata.tv.ui.components.LoadingCenter
import com.strata.tv.ui.components.loadable
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.LocalStrataPalette
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.opusFor
import com.strata.tv.ui.theme.paletteFor
import org.jellyfin.sdk.model.api.BaseItemDto
import java.util.UUID

@Composable
fun MovieDetailScreen(nav: NavController, id: String) {
    val itemId = UUID.fromString(id)
    val data by loadable(id) { ServiceLocator.repository.getItem(itemId) }
    when (val l = data) {
        is Loadable.Loading -> LoadingCenter()
        is Loadable.Error -> ErrorCenter(l.cause)
        is Loadable.Ready -> DetailContent(nav, l.value)
    }
}

@Composable
private fun DetailContent(nav: NavController, item: BaseItemDto) {
    val palette = paletteFor(item.id.toString())
    val opus = opusFor(item.id.toString())
    val repo = ServiceLocator.repository
    val beginFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) { runCatching { beginFocus.requestFocus() } }

    CompositionLocalProvider(LocalStrataPalette provides palette) {
        Box(modifier = Modifier.fillMaxSize()) {
            AsyncImage(
                model = repo.imageUrls.backdrop(item.id),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
            )
            // Gradient masks: left-to-right ink wash + bottom fade
            Box(
                modifier = Modifier.fillMaxSize().background(
                    Brush.horizontalGradient(
                        0f to StrataColors.Bg.copy(alpha = 0.95f),
                        0.35f to StrataColors.Bg.copy(alpha = 0.75f),
                        0.7f to StrataColors.Bg.copy(alpha = 0.2f),
                        1f to Color.Transparent,
                    ),
                ),
            )
            Box(
                modifier = Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0.55f to Color.Transparent,
                        1f to StrataColors.Bg,
                    ),
                ),
            )

            // Right-side feature presentation rail
            Column(
                horizontalAlignment = Alignment.End,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(end = 48.dp, top = 24.dp),
            ) {
                MonoStrip("Feature Presentation", alpha = 0.65f)
                Spacer(Modifier.height(6.dp))
                Row {
                    MonoStrip("Opus № $opus", alpha = 0.45f)
                }
                Spacer(Modifier.height(16.dp))
                Box(
                    Modifier
                        .width(40.dp)
                        .height(1.dp)
                        .background(StrataColors.Paper.copy(alpha = 0.3f)),
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "presented in",
                    color = StrataColors.Paper.copy(alpha = 0.55f),
                    style = TextStyle(
                        fontFamily = FontFamily.Serif,
                        fontStyle = FontStyle.Italic,
                        fontSize = 14.sp,
                    ),
                )
                Spacer(Modifier.height(4.dp))
                MonoStrip("4K · HDR · Atmos", alpha = 0.75f)
            }

            // Left-bottom: title + meta + buttons (pinned bottom, scales with content)
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .widthIn(max = 920.dp)
                    .padding(start = 48.dp, bottom = 28.dp, end = 32.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .width(36.dp)
                            .height(1.dp)
                            .background(StrataColors.Accent),
                    )
                    Spacer(Modifier.width(16.dp))
                    MonoStrip("Now Showing", alpha = 0.85f, tracking = 3.2.sp)
                    Spacer(Modifier.width(12.dp))
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(StrataColors.Accent),
                    )
                }
                Text(
                    text = item.name.orEmpty(),
                    color = StrataColors.Paper,
                    style = TextStyle(
                        fontFamily = FontFamily.Serif,
                        fontSize = 72.sp,
                        fontWeight = FontWeight.Medium,
                        lineHeight = 70.sp,
                        letterSpacing = (-2.5).sp,
                    ),
                )
                item.taglines?.firstOrNull()?.let {
                    Text(
                        text = it,
                        color = StrataColors.Accent2,
                        style = TextStyle(
                            fontFamily = FontFamily.Serif,
                            fontStyle = FontStyle.Italic,
                            fontSize = 20.sp,
                        ),
                    )
                }
                MetaRow(item)
                item.overview?.let {
                    Text(
                        text = it,
                        color = StrataColors.Paper.copy(alpha = 0.78f),
                        style = TextStyle(
                            fontFamily = FontFamily.Serif,
                            fontSize = 15.sp,
                            lineHeight = 22.sp,
                        ),
                        maxLines = 3,
                    )
                }
                Spacer(Modifier.height(4.dp))
                val resume = (item.userData?.playbackPositionTicks ?: 0L) > 0L
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    SolidActionButton(
                        label = if (resume) "RESUME" else "BEGIN",
                        modifier = Modifier.focusRequester(beginFocus),
                        onClick = { nav.navigate(Routes.watch(item.id.toString())) },
                    )
                    GhostActionButton(
                        label = "BACK",
                        onClick = { nav.popBackStack() },
                    )
                    Spacer(Modifier.width(8.dp))
                    MonoStrip("Press OK to begin", alpha = 0.4f)
                }
            }
        }
    }
}

@Composable
private fun MetaRow(item: BaseItemDto) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        item.productionYear?.let { MonoStrip("Anno $it", alpha = 0.7f); Dot() }
        item.runTimeTicks?.let {
            val mins = it / 600_000_000L
            val h = mins / 60
            val m = mins % 60
            MonoStrip(if (h > 0) "${h}H ${m}M" else "${m}M", alpha = 0.7f)
            Dot()
        }
        item.officialRating?.let { MonoStrip(it, alpha = 0.7f); Dot() }
        Text(
            text = "a motion picture",
            color = StrataColors.Paper.copy(alpha = 0.85f),
            style = TextStyle(
                fontFamily = FontFamily.Serif,
                fontStyle = FontStyle.Italic,
                fontSize = 14.sp,
            ),
        )
        item.communityRating?.let {
            Dot()
            val score = (it * 10).toInt()
            Text(
                text = "★ $score/100",
                color = StrataColors.Accent2,
                style = TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    letterSpacing = 2.sp,
                ),
            )
        }
    }
}

@Composable
private fun Dot() {
    Text(
        text = "·",
        color = StrataColors.Paper.copy(alpha = 0.3f),
        style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp),
    )
}

@Composable
private fun MonoStrip(
    text: String,
    alpha: Float = 0.6f,
    tracking: androidx.compose.ui.unit.TextUnit = 2.sp,
) {
    Text(
        text = text.uppercase(),
        color = StrataColors.Paper.copy(alpha = alpha),
        style = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            letterSpacing = tracking,
        ),
    )
}

@Composable
private fun SolidActionButton(
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "begin-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .scale(scale)
            .clip(RoundedCornerShape(4.dp))
            .background(if (focused) Color.White else StrataColors.Paper)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 26.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "▶",
                color = StrataColors.Ink,
                style = TextStyle(fontSize = 14.sp),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = label,
                color = StrataColors.Ink,
                style = TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 3.sp,
                ),
            )
        }
    }
}

@Composable
private fun GhostActionButton(label: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.04f else 1f, label = "ghost-scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(RoundedCornerShape(4.dp))
            .border(
                width = 1.dp,
                color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.4f),
                shape = RoundedCornerShape(4.dp),
            )
            .background(if (focused) StrataColors.Paper.copy(alpha = 0.08f) else Color.Transparent)
            .onFocusChanged { focused = it.isFocused }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 26.dp, vertical = 14.dp),
    ) {
        Text(
            text = label,
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
            ),
        )
    }
}
