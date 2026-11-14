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
        .padding(.bottom, Metrics.space4)
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
