package com.strata.tv.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
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
import androidx.tv.foundation.lazy.list.itemsIndexed
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
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
    firstFocus: FocusRequester? = null,
    onSelect: ((BaseItemPerson) -> Unit)? = null,
) {
    if (people.isEmpty()) return
    Column(modifier = modifier) {
        SectionHeading(title = title)
        Spacer(Modifier.height(20.dp))
        TvLazyRow(
            pivotOffsets = androidx.tv.foundation.PivotOffsets(parentFraction = 0.7f),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            // contentPadding (not Modifier.padding) so items scroll cleanly to the
            // screen edge instead of being hard-clipped at a 44dp gutter when the
            // row scrolls right — the leading cards no longer get cut off.
            contentPadding = PaddingValues(horizontal = 44.dp),
            modifier = Modifier.focusRestorer(),
        ) {
            itemsIndexed(people, key = { _, it -> it.id?.toString() ?: it.name.orEmpty() }) { idx, person ->
                CastCard(
                    person = person,
                    focusRequester = if (idx == 0) firstFocus else null,
                    onClick = { onSelect?.invoke(person) },
                )
            }
        }
    }
}

@Composable
private fun CastCard(
    person: BaseItemPerson,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, label = "cast-scale")
    val interaction = remember { MutableInteractionSource() }
    val imageUrl = person.id?.let { ServiceLocator.repository.imageUrls.person(it) }
    val initial = (person.name?.firstOrNull()?.uppercaseChar() ?: '?').toString()

    // Outer Column is the (unscaled) focus target so its layout bounds stay
    // constant — the scale lives on the inner wrapper, which stops the parent
    // column from re-pivoting vertically on every horizontal D-pad press.
    Column(
        modifier = Modifier
            .width(112.dp)
            .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            )
            .onFocusChanged { focused = it.isFocused },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Column(
          modifier = Modifier.scale(scale),
          horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Box(
            modifier = Modifier
                .size(100.dp)
                .clip(CircleShape)
                .background(StrataColors.Bg2)
                // Faint resting ring + bold Paper ring on focus, so the active
                // cast member is unmistakable (matches the poster/episode cards).
                .border(
                    width = if (focused) 4.dp else 1.dp,
                    color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.15f),
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
                    fontSize = 30.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
            // Dim every resting portrait so the focused one reads as clearly
            // brighter — the strongest "this is selected" cue on a wall of faces.
            if (!focused) {
                Box(
                    modifier = Modifier
                        .matchParentSize()
                        .background(StrataColors.Bg.copy(alpha = 0.45f)),
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(
            text = person.name.orEmpty(),
            color = if (focused) StrataColors.Paper else StrataColors.Paper.copy(alpha = 0.85f),
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
            style = StrataText.Chip,
            modifier = if (focused) Modifier.basicMarquee(iterations = Int.MAX_VALUE) else Modifier,
        )
        person.role?.takeIf { it.isNotBlank() }?.let { role ->
            Text(
                text = role,
                color = StrataColors.Paper.copy(alpha = 0.5f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = StrataText.CardSub,
            )
        }
      }
    }
}

/**
 * Shared section heading for Cast / Similar / Seasons. Clean Fraunces title,
 * no editorial number prefix, no italic. `num` is accepted-and-ignored so the
 * existing call sites keep compiling.
 */
@Composable
internal fun SectionHeading(title: String, num: String = "", modifier: Modifier = Modifier) {
    Text(
        text = title,
        color = StrataColors.Paper,
        style = StrataText.SectionTitle,
        modifier = modifier.padding(horizontal = 44.dp),
    )
}
