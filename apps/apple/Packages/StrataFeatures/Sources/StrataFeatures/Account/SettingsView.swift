import SwiftUI
import StrataKit
import StrataDesign

/// Settings, around the profile in use: who's watching, the other profiles on this device,
/// what this profile can do here, and app info. Each profile is a person's sign-in (on any
/// server); how the server groups people is the dashboard's business, not this page's.
struct SettingsView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var showLibraries = false
    @State private var showAddProfile = false
    @State private var showLinkTV = false
    @State private var showChangePassword = false
    @State private var confirmSignOut = false
    /// Asked first: removing a profile from this device.
    @State private var removing: SavedSignIn?
    @State private var renaming: SavedServer?
    @State private var newName = ""
    /// How many libraries the profile can watch: "Library" only shows with several.
    @State private var libraryCount = 0
    /// Shown as a tab (tvOS) rather than a sheet: no Done button.
    var embedded = false

    private var store: ServerStore { services.store }
    /// Server names only matter when the profiles span more than one.
    private var showsServers: Bool { Set(store.signIns.map(\.serverID)).count > 1 }

    var body: some View {
        NavigationStack {
            Form {
                // One card: who's watching, the other profiles to switch to, and what this one can do.
                Section {
                    if let active = store.active {
                        HStack(spacing: Metrics.space4) {
                            ProfileAvatar(name: active.name, seed: active.id, size: 56)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(active.name).font(.stTitle2)
                                Text(profileLine(active)).font(.stFootnote).foregroundStyle(Theme.ink3)
                            }
                            Spacer(minLength: 0)
                            if active.isKids { Text("Kids").eyebrowStyle(Theme.accentText) }
                        }
                        .padding(.vertical, Metrics.space1)
                        .profileActions(active, rename: startRename, remove: { removing = $0 }, store: store)
                    }
                    ForEach(store.signIns.filter { $0.id != store.activeID }) { signIn in
                        Button {
                            store.switchTo(signIn.id)
                            services.refreshClient()
                        } label: {
                            HStack(spacing: Metrics.space3) {
                                ProfileAvatar(name: signIn.name, seed: signIn.id, size: 32)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(signIn.name).foregroundStyle(Theme.ink)
                                    if showsServers, let server = store.server(for: signIn)?.name {
                                        Text(server).font(.stFootnote).foregroundStyle(Theme.ink3)
                                    }
                                }
                                Spacer()
                                if signIn.isKids { Text("Kids").eyebrowStyle(Theme.ink3) }
                                Text("Switch").font(.stFootnote).foregroundStyle(Theme.accentText)
                            }
                        }
                        .profileActions(signIn, rename: startRename, remove: { removing = $0 }, store: store)
                    }
                    Button {
                        showAddProfile = true
                    } label: {
                        Label("Add Profile", systemImage: "plus")
                    }
                    if let active = store.active {
                        #if os(tvOS)
                        // The TV's tab bar has no room for My List; it lives with the profile.
                        NavigationLink(value: Route.myList) { Label("My List", systemImage: "bookmark") }
                        #endif
                        if libraryCount > 1 {
                            Button {
                                showLibraries = true
                            } label: {
                                LabeledContent("Library", value: active.household?.name ?? "Choose")
                            }
                        }
                        #if os(iOS)
                        if !active.viewerOnly {
                            Button("Change Password") { showChangePassword = true }
                        }
                        #endif
                        Button("Sign Out \(active.name)", role: .destructive) { confirmSignOut = true }
                            .confirmationDialog("Sign \(active.name) out?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                                Button("Sign Out", role: .destructive) {
                                    Task {
                                        await store.signOut()
                                        services.refreshClient()
                                        if !embedded { dismiss() }
                                    }
                                }
                            } message: {
                                Text("\(active.name) is removed from this device. You can sign in again later.")
                            }
                    }
                } footer: {
                    if let active = store.active {
                        if active.isKids {
                            Text("A kids profile only sees titles within its age limit.")
                        } else if active.viewerOnly {
                            Text("Opened on this device without a password: \(active.name) can watch here, but changing settings needs the password.")
                        }
                    }
                }

                #if os(iOS)
                if store.active != nil {
                    Section {
                        Button {
                            showLinkTV = true
                        } label: {
                            Label("Link a TV", systemImage: "appletv")
                        }
                    } footer: {
                        Text("Sign in an Apple TV as \(store.active?.name ?? "you") by approving the code it shows.")
                    }
                }
                #endif

                // Cellular quality and downloads (iPhone and iPad).
                PlaybackSettingsSection()

                #if os(iOS)
                if store.active != nil { YourDataSection() }
                #endif

                Section {
                    if let server = store.activeServer {
                        // The name is this device's own; the server keeps its name for everyone else.
                        Button { startRename(server) } label: {
                            LabeledContent("Name") {
                                HStack(spacing: Metrics.space2) {
                                    Text(server.name)
                                    Image(systemName: "pencil").font(.stFootnote)
                                }
                            }
                        }
                        .foregroundStyle(Theme.ink)
                        LabeledContent("Address") {
                            Text(Self.address(server.url))
                                #if !os(tvOS)
                                .textSelection(.enabled)
                                #endif
                        }
                    } else {
                        LabeledContent("Name", value: "—")
                    }
                    LabeledContent("Version", value: store.activeServer?.version ?? "—")
                } header: {
                    Text("Server")
                }

                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                    if let server = store.activeServer {
                        PrivacyPolicyRow(server: server.url)
                    }
                    AcknowledgementsRow()
                } header: {
                    Text("App")
                }
            }
            .confirmationDialog("Remove \(removing?.name ?? "this profile") from this device?",
                                isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                                titleVisibility: .visible, presenting: removing) { signIn in
                Button("Remove", role: .destructive) {
                    store.remove(signIn.id)
                    services.refreshClient()
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("It's signed out here. You can add it again later.")
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
                libraryCount = (try? await store.households().count) ?? 0
            }
            .sheet(isPresented: $showLibraries) { NavigationStack { HouseholdPickerView(isSheet: true) } }
            .sheet(isPresented: $showAddProfile) { ConnectView(isAdding: true) }
            #if os(iOS)
            .sheet(isPresented: $showLinkTV) { ApproveDeviceView() }
            .sheet(isPresented: $showChangePassword) { ChangePasswordView() }
            #endif
        }
    }

    /// "@sam on Home Server", or just the server.
    private func profileLine(_ signIn: SavedSignIn) -> String {
        let server = store.server(for: signIn)?.name ?? "this server"
        return signIn.username.map { "@\($0) · \(server)" } ?? server
    }

    /// "http://192.168.1.20:8080", without a trailing slash.
    private static func address(_ url: URL) -> String {
        var text = url.absoluteString
        while text.hasSuffix("/") { text.removeLast() }
        return text
    }

    private func startRename(_ server: SavedServer) {
        newName = server.name
        renaming = server
    }
}

#if os(iOS)
/// Changes the active profile's password. Every other device signed in as it is
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

private extension View {
    /// Long-press (and, off the TV, swipe) actions on a profile row: rename its server, or
    /// remove it from this device (asked first).
    func profileActions(_ signIn: SavedSignIn, rename: @escaping (SavedServer) -> Void, remove: @escaping (SavedSignIn) -> Void, store: ServerStore) -> some View {
        self
            .contextMenu {
                if let server = store.server(for: signIn) {
                    Button { rename(server) } label: { Label("Rename Server", systemImage: "pencil") }
                }
                Button(role: .destructive) { remove(signIn) } label: { Label("Remove from This Device", systemImage: "minus.circle") }
            }
            #if !os(tvOS)
            // No full swipe, and no destructive role: that animates the row away before
            // anyone has confirmed, and it springs back if they cancel.
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button { remove(signIn) } label: { Label("Remove", systemImage: "minus.circle") }
                    .tint(.red)
            }
            #endif
    }
}
