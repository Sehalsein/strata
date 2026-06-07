package com.strata.tv.ui.screens

import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import androidx.tv.foundation.lazy.list.TvLazyColumn
import androidx.tv.material3.Text
import com.strata.tv.data.SearchResults
import com.strata.tv.di.ServiceLocator
import com.strata.tv.ui.components.PosterRow
import com.strata.tv.ui.nav.Routes
import com.strata.tv.ui.theme.StrataColors
import com.strata.tv.ui.theme.StrataText
import com.strata.tv.ui.theme.StrataType
import kotlinx.coroutines.delay

@Composable
fun SearchScreen(nav: NavController) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf(SearchResults(emptyList(), emptyList())) }
    val fieldFocus = remember { FocusRequester() }
    val resultsFocus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current

    // Auto-focus the search field on entry so the user can start typing
    // immediately. Without this, focus lands nowhere and the first D-pad
    // press scrolls instead of selecting the field.
    LaunchedEffect(Unit) {
        delay(150)
        runCatching { fieldFocus.requestFocus() }
    }

    LaunchedEffect(query) {
        if (query.length < 2) {
            results = SearchResults(emptyList(), emptyList()); return@LaunchedEffect
        }
        delay(300)
        results = runCatching { ServiceLocator.repository.search(query) }
            .getOrDefault(SearchResults(emptyList(), emptyList()))
    }

    // No horizontal padding on the Column: the result PosterRows carry their own
    // 48dp content padding (so focus rings aren't clipped), and the field/labels
    // are padded to match. Top inset clears the floating app bar.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 88.dp),
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            placeholder = {
                Text(
                    text = "Search movies and shows…",
                    color = StrataColors.Paper.copy(alpha = 0.4f),
                    style = TextStyle(fontFamily = StrataType.Plex, fontSize = 20.sp),
                )
            },
            textStyle = TextStyle(
                fontFamily = StrataType.Plex,
                color = StrataColors.Paper,
                fontSize = 20.sp,
            ),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Search,
                autoCorrect = false,
            ),
            keyboardActions = KeyboardActions(
                onSearch = {
                    keyboard?.hide()
                    runCatching { resultsFocus.requestFocus() }
                },
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
            ),
            modifier = Modifier
                .padding(start = 48.dp)
                .fillMaxWidth(0.5f)
                .focusRequester(fieldFocus)
                // D-pad Down on the field should dismiss the IME and move
                // focus to the first result row instead of being eaten by
                // the soft keyboard.
                .onPreviewKeyEvent { event ->
                    if (event.type == KeyEventType.KeyDown && event.key == Key.DirectionDown) {
                        keyboard?.hide()
                        focusManager.moveFocus(FocusDirection.Down)
                        true
                    } else false
                },
        )

        TvLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = 24.dp)
                .focusGroup(),
            verticalArrangement = Arrangement.spacedBy(40.dp),
            contentPadding = PaddingValues(vertical = 16.dp),
        ) {
            if (results.movies.isNotEmpty()) {
                item(key = "films-label") {
                    Text(
                        text = "Movies",
                        color = StrataColors.Paper,
                        style = StrataText.SectionTitle,
                        modifier = Modifier.padding(start = 48.dp),
                    )
                }
                item(key = "films-row") {
                    PosterRow(
                        items = results.movies,
                        firstFocusRequester = resultsFocus,
                        onSelect = { nav.navigate(Routes.movieDetail(it.id.toString())) },
                    )
                }
            }
            if (results.shows.isNotEmpty()) {
                item(key = "series-label") {
                    Text(
                        text = "Shows",
                        color = StrataColors.Paper,
                        style = StrataText.SectionTitle,
                        modifier = Modifier.padding(start = 48.dp),
                    )
                }
                item(key = "series-row") {
                    PosterRow(
                        items = results.shows,
                        firstFocusRequester = if (results.movies.isEmpty()) resultsFocus else null,
                        onSelect = { nav.navigate(Routes.showDetail(it.id.toString())) },
                    )
                }
            }
        }
    }
}
