import SwiftUI
import StrataKit
import StrataDesign

/// After signing in with a temporary password from an admin: a new password before
/// anything else (the server answers nothing else until then). On Apple TV, where typing
/// passwords with the remote is slow, it asks for it to be done on a phone or the dashboard.
struct ChooseNewPasswordView: View {
    @Environment(AppServices.self) private var services
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var saving = false
    @State private var error: String?

    /// The server's minimum.
    private static let minimumLength = 8
    private var name: String { services.store.active?.name ?? String(localized: "You", bundle: .module) }

    private var problem: String? {
        if new.isEmpty { return nil }
        if new.count < Self.minimumLength { return String(localized: "Use at least \(Self.minimumLength) characters.", bundle: .module) }
        if new == current { return String(localized: "Choose something other than the temporary password.", bundle: .module) }
        if !confirm.isEmpty && confirm != new { return String(localized: "The new passwords don't match.", bundle: .module) }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space6) {
                Image(systemName: "key.fill").font(.system(size: 40)).foregroundStyle(Theme.accentText)
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    Text("Choose your own password", bundle: .module).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    Text("\(name), you signed in with a temporary password. Pick one only you know to carry on.", bundle: .module)
                        .font(.stCallout).foregroundStyle(Theme.ink2)
                }
                #if os(tvOS)
                if let server = services.store.activeServer {
                    Text("Do it on your phone in the Strata app, or at \(ServerAddress.display(server.url)), then sign in here again.", bundle: .module)
                        .font(.stCallout).foregroundStyle(Theme.ink2)
                }
                #else
                VStack(spacing: Metrics.space3) {
                    SecureField(String(localized: "Temporary password", bundle: .module), text: $current).textContentType(.password).modifier(FieldStyle())
                    SecureField(String(localized: "New password", bundle: .module), text: $new).textContentType(.newPassword).modifier(FieldStyle())
                    SecureField(String(localized: "Confirm new password", bundle: .module), text: $confirm).textContentType(.newPassword).modifier(FieldStyle())
                }
                if let message = error ?? problem {
                    Label(message, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                }
                PrimaryButton(String(localized: "Save and Continue", bundle: .module), isLoading: saving) {
                    Task { await save() }
                }
                .disabled(saving || current.isEmpty || new.count < Self.minimumLength || confirm != new || new == current)
                #endif
                Button(String(localized: "Sign Out", bundle: .module)) {
                    Task {
                        await services.store.signOut()
                        services.refreshClient()
                    }
                }
                .font(.stCallout)
                #if !os(tvOS)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.accentText)
                .frame(maxWidth: .infinity)
                #endif
            }
            .frame(maxWidth: 480, alignment: .leading)
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, Metrics.space8)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg.ignoresSafeArea())
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            // Better Auth's change-password; the server clears the temporary flag, and the
            // refreshed account lets the app carry on.
            try await services.store.changePassword(current: current, new: new)
            services.refreshClient()
        } catch {
            let e = StrataError.wrap(error)
            self.error = e.code == "INVALID_PASSWORD" ? String(localized: "The temporary password isn't right.", bundle: .module) : e.message
        }
    }
}
