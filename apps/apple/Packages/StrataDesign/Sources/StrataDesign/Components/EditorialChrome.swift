import SwiftUI
#if os(iOS)
import UIKit
#endif

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
            // Hiding the nav bar makes UIKit disable the interactive
            // swipe-to-go-back gesture; this re-installs it.
            .background(InteractivePopGestureEnabler())
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

/// Restores the interactive swipe-to-go-back gesture on detail screens.
///
/// `NavigationStack` is backed by a `UINavigationController` on iOS. When the
/// navigation bar is hidden (`.toolbar(.hidden, for: .navigationBar)`), UIKit's
/// default `interactivePopGestureRecognizer` delegate vetoes the swipe — so the
/// edge gesture stops working even though there is something to pop. We slot a
/// tiny child controller into the hierarchy, find the enclosing nav controller,
/// and re-install the gesture with a permissive delegate that only allows the
/// swipe when the stack actually has a screen to pop back to.
private struct InteractivePopGestureEnabler: UIViewControllerRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> UIViewController {
        Controller(coordinator: context.coordinator)
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {
        context.coordinator.reinstall(from: controller)
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        weak var navigationController: UINavigationController?

        func reinstall(from controller: UIViewController) {
            guard let nav = controller.navigationController else { return }
            navigationController = nav
            nav.interactivePopGestureRecognizer?.delegate = self
            nav.interactivePopGestureRecognizer?.isEnabled = true
        }

        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            (navigationController?.viewControllers.count ?? 0) > 1
        }
    }

    private final class Controller: UIViewController {
        private let coordinator: Coordinator

        init(coordinator: Coordinator) {
            self.coordinator = coordinator
            super.init(nibName: nil, bundle: nil)
            view.isUserInteractionEnabled = false
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            coordinator.reinstall(from: self)
        }
    }
}
#endif

// MARK: - Scroll insets

public extension CGFloat {
    /// Comfortable gap below the last item in a scroll view, above the system
    /// tab bar / overscan safe area. Scroll views that respect the safe area
    /// (i.e. don't call `.ignoresSafeArea()` on the bottom edge) already get
    /// the tab-bar inset for free, so this is only the breathing room on top
    /// of that — keep it small to avoid a dead gap at the end of the list.
    static var strataScrollBottom: CGFloat {
        #if os(tvOS)
        60
        #else
        24
        #endif
    }
}
