import SwiftUI

/// The horizontal page gutter of the screen a view is hosted in. Carousels read
/// this so they can break out to the full screen width while keeping their cards
/// aligned to the same gutter as the surrounding text — see `fullBleedRow()`.
///
/// Defaults to 20 (the phone/tablet detail gutter); hosts with a different
/// gutter set it explicitly, e.g. Home uses `.environment(\.pageGutter, 28)`.
private struct PageGutterKey: EnvironmentKey {
    static let defaultValue: CGFloat = 20
}

public extension EnvironmentValues {
    var pageGutter: CGFloat {
        get { self[PageGutterKey.self] }
        set { self[PageGutterKey.self] = newValue }
    }
}

public extension View {
    /// Turns a horizontal `ScrollView` nested inside a gutter-padded column into
    /// a full-bleed carousel: the row spans the entire screen width so cards
    /// scroll smoothly off both edges instead of being hard-clipped at the
    /// padded column, while its content stays inset by `gutter` so the first
    /// card lines up under the section header.
    ///
    /// Apply to the `ScrollView` itself. `gutter` must match the host column's
    /// horizontal padding — pass `pageGutter` from the environment.
    func fullBleedRow(gutter: CGFloat) -> some View {
        self
            .contentMargins(.horizontal, gutter, for: .scrollContent)
            .padding(.horizontal, -gutter)
    }
}
