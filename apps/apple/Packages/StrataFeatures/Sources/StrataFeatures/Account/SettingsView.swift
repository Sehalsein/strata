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
    @State private var showEditProfile = false
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
            layout
                .confirmationDialog(String(localized: "Remove \(removing?.name ?? "this profile") from this device?", bundle: .module),
                                    isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                                    titleVisibility: .visible, presenting: removing) { signIn in
                    Button(String(localized: "Remove", bundle: .module), role: .destructive) {
                        store.remove(signIn.id)
                        services.refreshClient()
                    }
                    Button(String(localized: "Cancel", bundle: .module), role: .cancel) {}
                } message: { _ in
                    Text("It's signed out here. You can add it again later.", bundle: .module)
                }
                .alert(String(localized: "Rename Server", bundle: .module), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                    TextField(String(localized: "Name", bundle: .module), text: $newName)
                    Button(String(localized: "Cancel", bundle: .module), role: .cancel) {}
                    Button(String(localized: "Save", bundle: .module)) {
                        if let renaming { store.renameServer(renaming.id, to: newName) }
                    }
                } message: {
                    Text("Only on this device.", bundle: .module)
                }
                .routeDestinations()
                .toolbar {
                    if !embedded {
                        ToolbarItem(placement: .confirmationAction) { Button(String(localized: "Done", bundle: .module)) { dismiss() } }
                    }
                }
                .task(id: store.activeID) {
                    libraryCount = (try? await store.households().count) ?? 0
                }
                .pickerSheet(isPresented: $showLibraries) { NavigationStack { HouseholdPickerView(isSheet: true) } }
                .pickerSheet(isPresented: $showAddProfile) { ConnectView(isAdding: true) }
                .pickerSheet(isPresented: $showEditProfile) { EditProfileView() }
                #if os(iOS)
                .sheet(isPresented: $showLinkTV) { ApproveDeviceView() }
                .sheet(isPresented: $showChangePassword) { ChangePasswordView() }
                #endif
        }
    }

    /// Like the TV's own Settings: who's signed in on the left, the settings on the right,
    /// below the sidebar's button. Elsewhere, Settings' usual grouped list.
    @ViewBuilder private var layout: some View {
        #if os(tvOS)
        HStack(alignment: .top, spacing: Metrics.space20) {
            profileColumn
                .frame(width: 480)
                .padding(.top, Metrics.space12)
            // The focused row grows as it lifts: let it draw past the list's sides.
            form.scrollClipDisabled()
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 120)
        .ignoresSafeArea(edges: .top)
        .background(Theme.bg.ignoresSafeArea())
        // Rows in the system's colours, which flip when focused (the app's apricot accent
        // reads poorly on the white focused row).
        .tint(.primary)
        #else
        form
            .navigationTitle(Text("Settings", bundle: .module))
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
        #endif
    }

    #if os(tvOS)
    /// The profile in use, large: picture, name, where it's signed in, and what it can do.
    @ViewBuilder private var profileColumn: some View {
        if let active = store.active {
            VStack(spacing: Metrics.space4) {
                ProfileAvatar(name: active.name, seed: active.id, size: 240, imageURL: store.imageURL(for: active))
                    .padding(.bottom, Metrics.space2)
                Text(active.name).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink).multilineTextAlignment(.center)
                Text(profileLine(active)).font(.stCallout).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                if active.isKids { kidsTag }
                if let note = profileNote(active) {
                    Text(note).font(.stFootnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center).padding(.top, Metrics.space4)
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
        }
    }
    #endif

    private var form: some View {
        Form {
            #if !os(tvOS)
            // The profile card, like the account at the top of the system's Settings.
            if let active = store.active {
                Section {
                    Button { showEditProfile = true } label: {
                        HStack(spacing: Metrics.space4) {
                            ProfileAvatar(name: active.name, seed: active.id, size: 64, imageURL: store.imageURL(for: active))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(active.name).font(.stTitle2).foregroundStyle(.primary)
                                Text(profileLine(active)).font(.stFootnote).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                            if active.isKids { kidsTag }
                            Image(systemName: "chevron.right").font(.stFootnote.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, Metrics.space1)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text("Edit profile", bundle: .module))
                    .profileActions(active, rename: startRename, remove: { removing = $0 }, store: store)
                } footer: {
                    if let note = profileNote(active) { Text(note) }
                }
            }
            #endif

            // Everyone else signed in on this device, a press away.
            Section {
                ForEach(store.signIns.filter { $0.id != store.activeID }) { signIn in
                    Button {
                        store.switchTo(signIn.id)
                        services.refreshClient()
                    } label: {
                        HStack(spacing: Metrics.space3) {
                            ProfileAvatar(name: signIn.name, seed: signIn.id, size: Metrics.isTV ? 48 : 32, imageURL: store.imageURL(for: signIn))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(signIn.name).foregroundStyle(.primary)
                                if showsServers, let server = store.server(for: signIn)?.name {
                                    Text(server).font(.stFootnote).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if signIn.isKids { kidsTag }
                        }
                    }
                    .accessibilityHint(Text("Switches to this profile", bundle: .module))
                    .profileActions(signIn, rename: startRename, remove: { removing = $0 }, store: store)
                }
                Button { showAddProfile = true } label: {
                    Label(String(localized: "Add Profile", bundle: .module), systemImage: "person.badge.plus")
                }
            } header: {
                Text("Profiles", bundle: .module)
            }

            if let active = store.active {
                Section {
                    #if os(tvOS)
                    Button { showEditProfile = true } label: {
                        Label(String(localized: "Edit Profile", bundle: .module), systemImage: "person.crop.circle")
                    }
                    #endif
                    if libraryCount > 1 {
                        Button { showLibraries = true } label: {
                            LabeledContent {
                                Text(active.household?.name ?? String(localized: "Choose", bundle: .module))
                            } label: {
                                Label(String(localized: "Library", bundle: .module), systemImage: "books.vertical")
                            }
                        }
                    }
                    #if os(iOS)
                    if !active.viewerOnly {
                        Button { showChangePassword = true } label: {
                            Label(String(localized: "Change Password", bundle: .module), systemImage: "key")
                        }
                    }
                    Button { showLinkTV = true } label: {
                        Label(String(localized: "Link a TV", bundle: .module), systemImage: "appletv")
                    }
                    #endif
                } header: {
                    Text("Account", bundle: .module)
                } footer: {
                    #if os(iOS)
                    Text("Sign in an Apple TV as \(active.name) by approving the code it shows.", bundle: .module)
                    #endif
                }
            }

            // Cellular quality and downloads (iPhone and iPad).
            PlaybackSettingsSection()

            Section {
                if let server = store.activeServer {
                    // The name is this device's own; the server keeps its name for everyone else.
                    Button { startRename(server) } label: {
                        LabeledContent {
                            Text(server.name)
                        } label: {
                            Label(String(localized: "Name", bundle: .module), systemImage: "server.rack")
                        }
                    }
                    .accessibilityHint(Text("Renames the server on this device", bundle: .module))
                    LabeledContent {
                        Text(Self.address(server.url))
                            #if !os(tvOS)
                            .textSelection(.enabled)
                            #endif
                    } label: {
                        Label(String(localized: "Address", bundle: .module), systemImage: "network")
                    }
                }
                LabeledContent {
                    Text(store.activeServer?.version ?? "—")
                } label: {
                    Label(String(localized: "Version", bundle: .module), systemImage: "info.circle")
                }
            } header: {
                Text("Server", bundle: .module)
            }

            Section {
                LabeledContent {
                    Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                } label: {
                    Label(String(localized: "Version", bundle: .module), systemImage: "app.badge")
                }
                if let server = store.activeServer {
                    PrivacyPolicyRow(server: server.url)
                }
                AcknowledgementsRow()
            } header: {
                Text("About Strata", bundle: .module)
            }

            if let active = store.active {
                // On its own at the end, as in the system's Settings.
                Section {
                    Button(role: .destructive) { confirmSignOut = true } label: {
                        Label(String(localized: "Sign Out \(active.name)", bundle: .module), systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .confirmationDialog(String(localized: "Sign \(active.name) out?", bundle: .module), isPresented: $confirmSignOut, titleVisibility: .visible) {
                        Button(String(localized: "Sign Out", bundle: .module), role: .destructive) {
                            Task {
                                await store.signOut()
                                services.refreshClient()
                                if !embedded { dismiss() }
                            }
                        }
                    } message: {
                        Text("\(active.name) is removed from this device. You can sign in again later.", bundle: .module)
                    }
                }
            }
        }
    }

    private var kidsTag: some View {
        Text("Kids", bundle: .module).font(.stEyebrow).textCase(.uppercase).tracking(1).foregroundStyle(.secondary)
    }

    /// What this profile can do here, when it's limited.
    private func profileNote(_ active: SavedSignIn) -> String? {
        if active.isKids { return String(localized: "A kids profile only sees titles within its age limit.", bundle: .module) }
        if active.viewerOnly {
            return String(localized: "Opened on this device without a password: \(active.name) can watch here, but changing settings needs the password.", bundle: .module)
        }
        return nil
    }

    /// "@sam on Home Server", or just the server.
    private func profileLine(_ signIn: SavedSignIn) -> String {
        let server = store.server(for: signIn)?.name ?? String(localized: "this server", bundle: .module)
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
        if new.count < Self.minimumLength { return String(localized: "Use at least \(Self.minimumLength) characters.", bundle: .module) }
        if !confirm.isEmpty && confirm != new { return String(localized: "The new passwords don't match.", bundle: .module) }
        return nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField(String(localized: "Current password", bundle: .module), text: $current).textContentType(.password)
                } footer: {
                    Text("Other devices signed in as \(services.store.active?.name ?? "you") will be signed out.", bundle: .module)
                }
                Section {
                    SecureField(String(localized: "New password", bundle: .module), text: $new).textContentType(.newPassword)
                    SecureField(String(localized: "Confirm new password", bundle: .module), text: $confirm).textContentType(.newPassword)
                } footer: {
                    if let message = error ?? problem {
                        Text(message).foregroundStyle(Theme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(Text("Change Password", bundle: .module))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel", bundle: .module)) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button(String(localized: "Save", bundle: .module)) { Task { await save() } }
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
            self.error = e.code == "INVALID_PASSWORD" ? String(localized: "The current password isn't right.", bundle: .module) : e.message
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
                    Button { rename(server) } label: { Label(String(localized: "Rename Server", bundle: .module), systemImage: "pencil") }
                }
                Button(role: .destructive) { remove(signIn) } label: { Label(String(localized: "Remove from This Device", bundle: .module), systemImage: "minus.circle") }
            }
            #if !os(tvOS)
            // No full swipe, and no destructive role: that animates the row away before
            // anyone has confirmed, and it springs back if they cancel.
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button { remove(signIn) } label: { Label(String(localized: "Remove", bundle: .module), systemImage: "minus.circle") }
                    .tint(.red)
            }
            #endif
    }
}
