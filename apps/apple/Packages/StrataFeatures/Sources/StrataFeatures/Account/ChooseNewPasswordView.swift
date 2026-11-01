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
    private var name: String { services.store.active?.name ?? "You" }

    private var problem: String? {
        if new.isEmpty { return nil }
        if new.count < Self.minimumLength { return "Use at least \(Self.minimumLength) characters." }
        if new == current { return "Choose something other than the temporary password." }
        if !confirm.isEmpty && confirm != new { return "The new passwords don't match." }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space6) {
                Image(systemName: "key.fill").font(.system(size: 40)).foregroundStyle(Theme.accentText)
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    Text("Choose your own password").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    Text("\(name), you signed in with a temporary password. Pick one only you know to carry on.")
                        .font(.stCallout).foregroundStyle(Theme.ink2)
                }
                #if os(tvOS)
                if let server = services.store.activeServer {
                    Text("Do it on your phone in the Strata app, or at \(ServerAddress.display(server.url)), then sign in here again.")
                        .font(.stCallout).foregroundStyle(Theme.ink2)
                }
                #else
                VStack(spacing: Metrics.space3) {
                    SecureField("Temporary password", text: $current).textContentType(.password).modifier(FieldStyle())
                    SecureField("New password", text: $new).textContentType(.newPassword).modifier(FieldStyle())
                    SecureField("Confirm new password", text: $confirm).textContentType(.newPassword).modifier(FieldStyle())
                }
                if let message = error ?? problem {
                    Label(message, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                }
                PrimaryButton("Save and Continue", isLoading: saving) {
                    Task { await save() }
                }
                .disabled(saving || current.isEmpty || new.count < Self.minimumLength || confirm != new || new == current)
                #endif
                Button("Sign Out") {
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
            self.error = e.code == "INVALID_PASSWORD" ? "The temporary password isn't right." : e.message
        }
    }
}
