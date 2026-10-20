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
                                if server.id == services.store.activeID {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.accentText)
                                }
                            }
                        }
                        #if !os(tvOS)
                        .swipeActions {
                            Button("Remove", role: .destructive) { services.store.removeServer(server.id) }
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

                Section("About") {
                    LabeledContent("Server version", value: services.store.active?.version ?? "—")
                    LabeledContent("App version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                }
            }
            .navigationTitle("Settings")
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
        }
    }
}
