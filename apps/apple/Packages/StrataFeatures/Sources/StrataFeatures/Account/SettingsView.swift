import SwiftUI
import StrataKit
import StrataDesign

/// Servers, profile and app info.
struct SettingsView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var showProfiles = false
    @State private var showAddServer = false
    @State private var confirmSignOut = false
    @State private var showSignInTV = false
    @State private var renaming: SavedServer?
    /// Asked first: removing a server signs this device out of it.
    @State private var removing: SavedServer?
    @State private var newName = ""
    /// Shown as a tab (tvOS) rather than a sheet: no Done button.
    var embedded = false

    var body: some View {
        NavigationStack {
            Form {
                if let active = services.store.active {
                    Section {
                        HStack(spacing: Metrics.space3) {
                            ProfileAvatar(name: active.profileName ?? active.username, seed: "\(active.profileId ?? 0)", size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(active.profileName ?? active.username).font(.stHeadline)
                                Text("Signed in as \(active.username)").font(.stFootnote).foregroundStyle(Theme.ink3)
                            }
                        }
                        Button("Switch Profile") { showProfiles = true }
                        #if os(tvOS)
                        // The TV's tab bar has no room for My List; it lives with the profile.
                        NavigationLink(value: Route.myList) { Label("My List", systemImage: "bookmark") }
                        #endif
                        #if os(iOS)
                        Button("Sign In a TV") { showSignInTV = true }
                        #endif
                    }
                }

                Section("Servers") {
                    ForEach(services.store.servers) { server in
                        Button {
                            services.store.switchServer(server.id)
                            services.refreshClient()
                        } label: {
                            HStack {
                                Image(systemName: "server.rack").foregroundStyle(Theme.ink2)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(server.name).foregroundStyle(Theme.ink)
                                    Text(server.url.host() ?? server.url.absoluteString).font(.stFootnote).foregroundStyle(Theme.ink3)
                                }
                                Spacer()
                                if let version = server.version { SpecBadge("v\(version)") }
                                if server.id == services.store.activeID {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.accentText)
                                }
                            }
                        }
                        .contextMenu {
                            Button { startRename(server) } label: { Label("Rename", systemImage: "pencil") }
                            Button(role: .destructive) { removing = server } label: { Label("Remove", systemImage: "trash") }
                        }
                        #if !os(tvOS)
                        // No full swipe, and no destructive role: that animates the row away
                        // before anyone has confirmed, and it springs back if they cancel.
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button { removing = server } label: { Label("Remove", systemImage: "trash") }
                                .tint(.red)
                            Button { startRename(server) } label: { Label("Rename", systemImage: "pencil") }
                                .tint(Theme.ink3)
                        }
                        #endif
                    }
                    Button {
                        showAddServer = true
                    } label: {
                        Label("Add Server", systemImage: "plus")
                    }
                }

                Section {
                    Button("Sign Out of \(services.store.active?.name ?? "Server")", role: .destructive) { confirmSignOut = true }
                        .confirmationDialog("Sign out of \(services.store.active?.name ?? "this server")?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                            Button("Sign Out", role: .destructive) {
                                Task {
                                    await services.store.signOut()
                                    services.refreshClient()
                                    if !embedded { dismiss() }
                                }
                            }
                        }
                }

                Section {
                    LabeledContent("App Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                } header: {
                    Text("About")
                }
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
            .sheet(isPresented: $showProfiles) { ProfilePickerView(isSheet: true) }
            .sheet(isPresented: $showAddServer) { ConnectView(isAddingServer: true) }
            .sheet(isPresented: $showSignInTV) { ApproveDeviceView() }
            .confirmationDialog("Remove \(removing?.name ?? "this server")?",
                                isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                                titleVisibility: .visible, presenting: removing) { server in
                Button("Remove", role: .destructive) { remove(server) }
                Button("Cancel", role: .cancel) {}
            } message: { server in
                Text(server.id == services.store.activeID
                     ? "This device will be signed out of it. You can add it again later."
                     : "You can add it again later.")
            }
            .alert("Rename Server", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $newName)
                Button("Cancel", role: .cancel) {}
                Button("Save") {
                    if let renaming { services.store.renameServer(renaming.id, to: newName) }
                }
            } message: {
                Text("Only on this device.")
            }
        }
    }

    private func remove(_ server: SavedServer) {
        // The one in use: the app restarts on the next server (or the connect screen), so
        // close Settings first rather than have it torn away mid-animation.
        if server.id == services.store.activeID, !embedded {
            dismiss()
            Task {
                try? await Task.sleep(for: .milliseconds(400))
                services.store.removeServer(server.id)
            }
        } else {
            withAnimation { services.store.removeServer(server.id) }
        }
    }

    private func startRename(_ server: SavedServer) {
        newName = server.name
        renaming = server
    }
}
