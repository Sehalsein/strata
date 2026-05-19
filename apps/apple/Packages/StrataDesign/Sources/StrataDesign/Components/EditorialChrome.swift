import SwiftUI

// MARK: - Editorial detail chrome
//
// PhoneShell hosts each detail view inside a `NavigationStack`, which renders
// an opaque nav-bar row above the cover image. On iPad regular size class
// the TabView already sits at the top and the back chevron is hoisted into
// it, so the image bleeds edge-to-edge. We replicate that bleed on iPhone
// by hiding the nav bar and supplying our own floating back button.

public extension View {
    /// Hides the system navigation bar (iOS only) and overlays a circular
    /// editorial back button at top-leading. No-op on macOS / tvOS.
    func editorialDetailChrome() -> some View {
        modifier(EditorialDetailChrome())
    }
}

private struct EditorialDetailChrome: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .toolbar(.hidden, for: .navigationBar)
            .overlay(alignment: .topLeading) { EditorialBackButton() }
        #else
        content
        #endif
    }
}

#if os(iOS)
private struct EditorialBackButton: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Strata.Tokens.paper)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Strata.Tokens.bg.opacity(0.55)))
                .overlay(Circle().stroke(Strata.Tokens.paperHair, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.leading, 16)
        .padding(.top, 8)
        .accessibilityLabel("Back")
    }
}
#endif
