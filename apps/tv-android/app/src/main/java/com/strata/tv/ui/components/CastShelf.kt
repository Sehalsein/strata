package com.strata.tv.ui.components

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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.foundation.lazy.list.TvLazyRow
import androidx.tv.foundation.lazy.list.items
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataType
import org.jellyfin.sdk.model.api.BaseItemPerson

/**
 * Editorial cast / crew shelf. Mirrors Apple's `DetailSections.CastShelf` —
 * round portrait, name, role. Personless members get a paper-circle initial
 * fallback so the row stays balanced.
 */
@Composable
fun CastShelf(
    people: List<BaseItemPerson>,
    modifier: Modifier = Modifier,
    title: String = "Cast",
    onSelect: ((BaseItemPerson) -> Unit)? = null,
) {
    if (people.isEmpty()) return
    Column(modifier = modifier) {
        SectionHeading(title = title, num = "·")
        Spacer(Modifier.height(16.dp))
        TvLazyRow(
            pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.1f),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            modifier = Modifier
                .padding(horizontal = 48.dp)
                .focusRestorer(),
        ) {
            items(people, key = { it.id?.toString() ?: it.name.orEmpty() }) { person ->
                CastCard(person = person, onClick = { onSelect?.invoke(person) })
            }
        }
    }
}

@Composable
private fun CastCard(person: BaseItemPerson, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "cast-scale")
    val interaction = remember { MutableInteractionSource() }
    val imageUrl = person.id?.let { ServiceLocator.repository.imageUrls.person(it) }
    val initial = (person.name?.firstOrNull()?.uppercaseChar() ?: '?').toString()

    Column(
        modifier = Modifier
            .width(120.dp)
            .scale(scale)
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            )
            .onFocusChanged { focused = it.isFocused },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(112.dp)
                .clip(CircleShape)
                .background(StrataColors.Bg2)
                .border(
                    width = if (focused) 2.dp else 0.dp,
                    color = if (focused) StrataColors.Accent2 else Color.Transparent,
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (imageUrl != null) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = person.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            // Initial fallback sits underneath the AsyncImage so it shows
            // whenever the portrait fails or is missing — Coil silently
            // renders nothing on 404, which is fine since this is below.
            Text(
                text = initial,
                color = StrataColors.Paper.copy(alpha = 0.6f),
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontSize = 38.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            text = person.name.orEmpty(),
            color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.85f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = TextStyle(
                fontFamily = StrataType.Plex,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            ),
        )
        person.role?.takeIf { it.isNotBlank() }?.let { role ->
            Text(
                text = role,
                color = StrataColors.Paper.copy(alpha = 0.5f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = TextStyle(
                    fontFamily = StrataType.Fraunces,
                    fontSize = 12.sp,
                    fontStyle = FontStyle.Italic,
                ),
            )
        }
    }
}

@Composable
internal fun SectionHeading(title: String, num: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.padding(horizontal = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = num,
            color = StrataColors.Paper.copy(alpha = 0.4f),
            style = TextStyle(
                fontFamily = StrataType.Mono,
                fontSize = 11.sp,
                letterSpacing = 2.sp,
            ),
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = title,
            color = StrataColors.Paper,
            style = TextStyle(
                fontFamily = StrataType.Fraunces,
                fontSize = 24.sp,
                fontStyle = FontStyle.Italic,
                fontWeight = FontWeight.Medium,
                letterSpacing = (-0.4).sp,
            ),
        )
    }
}
