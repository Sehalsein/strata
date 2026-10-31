import SwiftUI
import StrataKit
import StrataDesign

/// The account and household in use, the other accounts signed in on this device, and
/// app info. Members and household settings are managed in the server's web dashboard.
struct SettingsView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var showAccounts = false
    @State private var showHouseholds = false
    @State private var showAddAccount = false
    @State private var showLinkTV = false
    @State private var showChangePassword = false
    @State private var confirmSignOut = false
    /// Asked first: signing an account out of this device.
    @State private var removing: SavedSignIn?
    @State private var renaming: SavedServer?
    @State private var newName = ""
    /// How many households the account is in: "Switch Household" only shows with several.
    @State private var householdCount = 0
    /// Shown as a tab (tvOS) rather than a sheet: no Done button.
    var embedded = false

    private var store: ServerStore { services.store }

    var body: some View {
        NavigationStack {
            Form {
                if let active = store.active {
                    Section {
                        HStack(spacing: Metrics.space3) {
                            ProfileAvatar(name: active.name, seed: active.id, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(active.name).font(.stHeadline)
                                Text(accountLine(active)).font(.stFootnote).foregroundStyle(Theme.ink3)
                            }
                        }
                        Button("Switch Account") { showAccounts = true }
                        #if os(tvOS)
                        // The TV's tab bar has no room for My List; it lives with the account.
                        NavigationLink(value: Route.myList) { Label("My List", systemImage: "bookmark") }
                        #endif
                    } footer: {
                        if active.viewerOnly {
                            Text("Signed in without a password: this device can watch, but not change the household's settings.")
                        }
                    }

                    Section("Household") {
                        LabeledContent(active.household?.name ?? "None chosen", value: active.household?.roleLabel ?? "")
                        if active.isKids {
                            LabeledContent("Kids account", value: "Titles above its limit are hidden")
                        }
                        if householdCount > 1 {
                            Button("Switch Household") { showHouseholds = true }
                        }
                    }

                    #if os(iOS)
                    Section {
                        Button("Link a TV") { showLinkTV = true }
                        if !active.viewerOnly {
                            Button("Change Password") { showChangePassword = true }
                        }
                    }
                    #endif
                }

                Section("Accounts on this device") {
                    ForEach(store.signIns) { signIn in
                        Button {
                            store.switchTo(signIn.id)
                            services.refreshClient()
                        } label: {
                            HStack(spacing: Metrics.space3) {
                                ProfileAvatar(name: signIn.name, seed: signIn.id, size: 32)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(signIn.name).foregroundStyle(Theme.ink)
                                    Text([store.server(for: signIn)?.name, signIn.household?.name].compactMap { $0 }.joined(separator: " · "))
                                        .font(.stFootnote).foregroundStyle(Theme.ink3)
                                }
                                Spacer()
                                if let version = store.server(for: signIn)?.version { SpecBadge("v\(version)") }
                                if signIn.id == store.activeID {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.accentText)
                                }
                            }
                        }
                        .contextMenu {
                            if let server = store.server(for: signIn) {
                                Button { startRename(server) } label: { Label("Rename Server", systemImage: "pencil") }
                            }
                            Button(role: .destructive) { removing = signIn } label: { Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right") }
                        }
                        #if !os(tvOS)
                        // No full swipe, and no destructive role: that animates the row away
                        // before anyone has confirmed, and it springs back if they cancel.
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button { removing = signIn } label: { Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right") }
                                .tint(.red)
                        }
                        #endif
                    }
                    Button {
                        showAddAccount = true
                    } label: {
                        Label("Add Account", systemImage: "plus")
                    }
                }

                if let active = store.active {
                    Section {
                        Button("Sign Out \(active.name)", role: .destructive) { confirmSignOut = true }
                            .confirmationDialog("Sign \(active.name) out of \(store.activeServer?.name ?? "this server")?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                                Button("Sign Out", role: .destructive) {
                                    Task {
                                        await store.signOut()
                                        services.refreshClient()
                                        if !embedded { dismiss() }
                                    }
                                }
                            }
                    }
                }

                Section {
                    LabeledContent("Server", value: store.activeServer?.name ?? "—")
                    LabeledContent("Server Version", value: store.activeServer?.version ?? "—")
                    LabeledContent("App Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                } header: {
                    Text("About")
                }
            }
            .confirmationDialog("Sign \(removing?.name ?? "this account") out of this device?",
                                isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                                titleVisibility: .visible, presenting: removing) { signIn in
                Button("Sign Out", role: .destructive) {
                    store.remove(signIn.id)
                    services.refreshClient()
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("You can sign in again later.")
            }
            .alert("Rename Server", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $newName)
                Button("Cancel", role: .cancel) {}
                Button("Save") {
                    if let renaming { store.renameServer(renaming.id, to: newName) }
                }
            } message: {
                Text("Only on this device.")
            }
            .navigationTitle("Settings")
            .routeDestinations()
            #if !os(tvOS)
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            #endif
            .toolbar {
                if !embedded {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
            }
            .task(id: store.activeID) {
                householdCount = (try? await store.households().count) ?? 0
            }
            .sheet(isPresented: $showAccounts) { NavigationStack { WhoIsWatchingView(isSheet: true) } }
            .sheet(isPresented: $showHouseholds) { NavigationStack { HouseholdPickerView(isSheet: true) } }
            .sheet(isPresented: $showAddAccount) { ConnectView(isAdding: true) }
            #if os(iOS)
            .sheet(isPresented: $showLinkTV) { ApproveDeviceView() }
            .sheet(isPresented: $showChangePassword) { ChangePasswordView() }
            #endif
        }
    }

    private func accountLine(_ signIn: SavedSignIn) -> String {
        let who = signIn.username.map { "@\($0)" } ?? "Signed in"
        return "\(who) on \(store.server(for: signIn)?.name ?? "this server")"
    }

    private func startRename(_ server: SavedServer) {
        newName = server.name
        renaming = server
    }
}

#if os(iOS)
/// Changes the active account's password. Every other device signed in to the account is
/// signed out; this one carries on.
struct ChangePasswordView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var saving = false
    @State private var error: String?

    /// The server's minimum.
    private static let minimumLength = 8

    private var problem: String? {
        if new.isEmpty { return nil }
        if new.count < Self.minimumLength { return "Use at least \(Self.minimumLength) characters." }
        if !confirm.isEmpty && confirm != new { return "The new passwords don't match." }
        return nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Current password", text: $current).textContentType(.password)
                } footer: {
                    Text("Other devices signed in as \(services.store.active?.name ?? "you") will be signed out.")
                }
                Section {
                    SecureField("New password", text: $new).textContentType(.newPassword)
                    SecureField("Confirm new password", text: $confirm).textContentType(.newPassword)
                } footer: {
                    if let message = error ?? problem {
                        Text(message).foregroundStyle(Theme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Change Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(current.isEmpty || new.count < Self.minimumLength || confirm != new)
                    }
                }
            }
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await services.store.changePassword(current: current, new: new)
            services.refreshClient()
            dismiss()
        } catch {
            let e = StrataError.wrap(error)
            self.error = e.code == "INVALID_PASSWORD" ? "The current password isn't right." : e.message
        }
    }

}
#endif
