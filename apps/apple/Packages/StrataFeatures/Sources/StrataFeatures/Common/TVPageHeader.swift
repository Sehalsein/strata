import SwiftUI
import StrataDesign

/// The top of a list page on the TV: a back button when the page was pushed (Menu goes
/// back too), then the title, both part of the scrolling content. tvOS pins a navigation
/// title over the page instead, where the grid scrolls underneath it. Nothing elsewhere:
/// iPhone and iPad keep the navigation bar's title and back button.
struct TVPageHeader: View {
    let title: String
    @Environment(\.dismiss) private var dismiss
    /// True on a pushed page; a tab's own page (My List in the sidebar) has nowhere to go back to.
    @Environment(\.isPresented) private var isPresented

    var body: some View {
        #if os(tvOS)
        VStack(alignment: .leading, spacing: Metrics.space6) {
            if isPresented {
                GlassButton("Back", systemImage: "chevron.left", iconOnly: true, size: Metrics.heroControlSize) { dismiss() }
            }
            Text(title)
                .font(.stTitle1)
                .titleTracking()
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Metrics.gutter)
        // A tab's own page has the sidebar's "‹ Title" button in the top corner: start
        // below it. A pushed page's back button takes that place instead.
        // Lined up with the Movies and Anime titles (`TVTabHeader`).
        .padding(.top, isPresented ? 0 : 20)
        // Room for the first row's focus lift under the title.
        .padding(.bottom, Metrics.space10)
        // The back button and the grid are separate stops for the focus engine.
        .focusSection()
        #endif
    }
}

extension View {
    /// The navigation bar's title on iPhone and iPad; on the TV, `TVPageHeader` shows it.
    @ViewBuilder func pageTitle(_ title: String) -> some View {
        #if os(tvOS)
        self
        #else
        navigationTitle(title)
        #endif
    }
}

#if os(tvOS)
/// The top of a tab's own page on the TV when it has no spotlight: below the sidebar's
/// button, the page's title with its filter (genre, category) beside it.
struct TVTabHeader<Accessory: View>: View {
    let title: String
    @ViewBuilder let accessory: () -> Accessory

    var body: some View {
        HStack(alignment: .center, spacing: Metrics.space8) {
            Text(title)
                .font(.stTitle1)
                .titleTracking()
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
            accessory()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 140)
        // Full width, so down from the sidebar button lands on the filter.
        .focusSection()
    }
}
#endif
