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
                            Button(role: .destructive) { services.store.removeServer(server.id) } label: { Label("Remove", systemImage: "trash") }
                        }
                        #if !os(tvOS)
                        .swipeActions {
                            Button("Remove", role: .destructive) { services.store.removeServer(server.id) }
                            Button("Rename") { startRename(server) }
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

    private func startRename(_ server: SavedServer) {
        newName = server.name
        renaming = server
    }
}
