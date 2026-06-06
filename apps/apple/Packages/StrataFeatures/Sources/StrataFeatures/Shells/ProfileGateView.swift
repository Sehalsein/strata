#if os(tvOS)
import SwiftUI
import StrataKit
import StrataDesign

/// tvOS "Who's watching?" profile chooser. Serves two roles:
///   • a launch gate (shown by `RootView` when more than one profile exists)
///   • an in-app switcher (presented as a fullScreenCover from the shell)
/// Selecting a profile swaps the active token (no re-auth) and calls
/// `onChosen`; the "Add Profile" tile runs the standard login flow.
struct ProfileGateView: View {
    @Environment(AppServices.self) private var services
    var onChosen: () -> Void

    @State private var showAdd = false
    @State private var addStartUserId: String?

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: 48)]

    var body: some View {
        ZStack {
            Strata.Tokens.bg.ignoresSafeArea()
            VStack(spacing: 56) {
                VStack(spacing: 10) {
                    Text("STRATA").strataSpec()
                    Text("Who's watching?")
                        .font(.fraunces(56, opticalSize: 144, soft: 50))
                        .foregroundStyle(Strata.Tokens.paper)
                }

                LazyVGrid(columns: columns, spacing: 48) {
                    ForEach(services.auth.savedAccounts) { account in
                        ProfileTile(session: account,
                                    isActive: account.userId == services.auth.session?.userId) {
                            services.auth.switchAccount(to: account.userId)
                            services.refreshSessionDependentServices()
                            onChosen()
                        }
                    }
                    AddProfileTile { showAdd = true }
                }
                .padding(.horizontal, 80)
            }
        }
        .fullScreenCover(isPresented: $showAdd) {
            LoginView()
                .onAppear { addStartUserId = services.auth.session?.userId }
                .onChange(of: services.auth.session?.userId) { _, newValue in
                    // A new account signed in → it's now active; enter the app.
                    if newValue != addStartUserId {
                        showAdd = false
                        onChosen()
                    }
                }
        }
    }
}

/// A single focusable profile: large avatar + name, with an active checkmark.
private struct ProfileTile: View {
    let session: Session
    let isActive: Bool
    let onSelect: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 18) {
                ProfileAvatar(session: session, size: 180)
                    .overlay(alignment: .bottomTrailing) {
                        if isActive {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 36))
                                .foregroundStyle(Strata.Tokens.accent2)
                                .background(Circle().fill(Strata.Tokens.bg))
                        }
                    }
                    .overlay(
                        Circle().stroke(focused ? Strata.Tokens.paper : .clear, lineWidth: 4)
                    )
                    .scaleEffect(focused ? 1.08 : 1.0)
                    .animation(.easeOut(duration: 0.15), value: focused)
                Text(session.userName ?? "User")
                    .font(.plex(24, weight: focused ? .semibold : .regular))
                    .foregroundStyle(focused ? Strata.Tokens.paper : Strata.Tokens.paperDim)
            }
        }
        .buttonStyle(.plain)
        .focused($focused)
    }
}

/// The "+" tile that starts the add-profile login flow.
private struct AddProfileTile: View {
    let onSelect: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 18) {
                ZStack {
                    Circle().fill(Strata.Tokens.paper.opacity(0.06))
                    Image(systemName: "plus")
                        .font(.system(size: 64, weight: .light))
                        .foregroundStyle(Strata.Tokens.paperDim)
                }
                .frame(width: 180, height: 180)
                .overlay(Circle().stroke(focused ? Strata.Tokens.paper : Strata.Tokens.paperHair, lineWidth: focused ? 4 : 1))
                .scaleEffect(focused ? 1.08 : 1.0)
                .animation(.easeOut(duration: 0.15), value: focused)
                Text("Add Profile")
                    .font(.plex(24))
                    .foregroundStyle(Strata.Tokens.paperDim)
            }
        }
        .buttonStyle(.plain)
        .focused($focused)
    }
}
#endif
