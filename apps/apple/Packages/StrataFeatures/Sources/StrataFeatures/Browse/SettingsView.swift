import SwiftUI
import StrataKit
import StrataDesign

/// Lightweight settings presented as a sheet (iOS-default styling). Surfaces
/// the current account/server, app + build version, server switching, and
/// sign-out.
struct SettingsView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var showServers = false
    @State private var showAccounts = false

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }
    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    if let session = services.auth.session {
                        HStack(spacing: 12) {
                            ProfileAvatar(session: session, size: 34)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(session.userName ?? "User")
                                    .foregroundStyle(.primary)
                                Text(session.serverURL.absoluteString)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                    }
                }

                Section {
                    Button { showAccounts = true } label: {
                        SettingsActionRow(title: "Switch Profile",
                                          systemImage: "person.2.fill",
                                          tint: .purple, showChevron: true)
                    }
                    .buttonStyle(.plain)

                    Button { showServers = true } label: {
                        SettingsActionRow(title: "Switch Server",
                                          systemImage: "arrow.left.arrow.right",
                                          tint: .blue, showChevron: true)
                    }
                    .buttonStyle(.plain)

                    Button(role: .destructive) {
                        services.auth.signOut()
                        services.refreshSessionDependentServices()
                        dismiss()
                    } label: {
                        SettingsActionRow(title: "Sign Out",
                                          systemImage: "rectangle.portrait.and.arrow.right",
                                          tint: .red, destructive: true)
                    }
                    .buttonStyle(.plain)
                }

                Section("About") {
                    LabeledContent("Version", value: appVersion)
                    LabeledContent("Build", value: buildNumber)
                }
            }
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showServers) { ServerPickerView() }
            .sheet(isPresented: $showAccounts) { AccountPickerView() }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 360)
        #elseif os(iOS)
        .presentationDetents([.medium, .large])
        #endif
    }
}

/// Nested sheet listing saved servers. Tap to switch (no re-auth), swipe to
/// remove, or add a new one via the standard login flow.
struct ServerPickerView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var showAdd = false

    var body: some View {
        NavigationStack {
            List {
                Section("Servers") {
                    ForEach(services.auth.savedEndpoints, id: \.self) { url in
                        Button {
                            services.auth.switchEndpoint(to: url)
                            services.refreshSessionDependentServices()
                            dismiss()
                        } label: {
                            endpointRow(url)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete(perform: deleteEndpoints)
                }

                Section {
                    Button { showAdd = true } label: {
                        SettingsActionRow(title: "Add Server",
                                          systemImage: "plus", tint: .green)
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Servers")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showAdd) { AddServerSheet() }
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 380)
        #elseif os(iOS)
        .presentationDetents([.medium, .large])
        #endif
    }

    private func endpointRow(_ url: URL) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "server.rack")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Color.indigo, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            Text(url.absoluteString)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            if url == services.auth.session?.serverURL {
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.tint)
            }
        }
        .contentShape(Rectangle())
    }

    private func deleteEndpoints(_ offsets: IndexSet) {
        let endpoints = services.auth.savedEndpoints
        for index in offsets where endpoints.indices.contains(index) {
            services.auth.removeEndpoint(endpoints[index])
        }
        services.refreshSessionDependentServices()
    }
}

/// "Add Server" is just a server-address input. It adds the endpoint and
/// switches the current session to it — same token/user, new base URL. No
/// login required.
struct AddServerSheet: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""

    private var parsedURL: URL? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespaces)),
              url.scheme != nil else { return nil }
        return url
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://media.example.com", text: $address)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        #endif
                        .onSubmit(add)
                } header: {
                    Text("Server Address")
                } footer: {
                    Text("Add another address for the same server (e.g. a local IP, domain, or VPN). Switching only changes the endpoint — you stay signed in.")
                }
            }
            .navigationTitle("Add Server")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: add)
                        .disabled(parsedURL == nil)
                }
            }
        }
    }

    private func add() {
        guard let url = parsedURL else { return }
        services.auth.switchEndpoint(to: url)
        services.refreshSessionDependentServices()
        dismiss()
    }
}

/// Sheet listing saved profiles (Jellyfin accounts). Tap to switch (no
/// re-auth — tokens are stored), swipe to remove, or add another via the
/// standard login flow.
struct AccountPickerView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var showAdd = false

    var body: some View {
        NavigationStack {
            List {
                Section("Profiles") {
                    ForEach(services.auth.savedAccounts) { account in
                        Button {
                            services.auth.switchAccount(to: account.userId)
                            services.refreshSessionDependentServices()
                            dismiss()
                        } label: {
                            accountRow(account)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete(perform: deleteAccounts)
                }

                Section {
                    Button { showAdd = true } label: {
                        SettingsActionRow(title: "Add Profile",
                                          systemImage: "plus", tint: .green)
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Profiles")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showAdd) { AddAccountSheet() }
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 380)
        #elseif os(iOS)
        .presentationDetents([.medium, .large])
        #endif
    }

    private func accountRow(_ account: Session) -> some View {
        HStack(spacing: 12) {
            ProfileAvatar(session: account, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(account.userName ?? "User")
                    .foregroundStyle(.primary)
                Text(account.serverURL.absoluteString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            if account.userId == services.auth.session?.userId {
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.tint)
            }
        }
        .contentShape(Rectangle())
    }

    private func deleteAccounts(_ offsets: IndexSet) {
        let accounts = services.auth.savedAccounts
        for index in offsets where accounts.indices.contains(index) {
            services.auth.removeAccount(accounts[index].userId)
        }
        services.refreshSessionDependentServices()
    }
}

/// "Add Profile" presents the standard login flow in a sheet. On success the
/// new account becomes active (`AuthStore.signIn` adds + switches), so we watch
/// the active user id and dismiss once it changes.
struct AddAccountSheet: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var startUserId: String?

    var body: some View {
        LoginView()
            .onAppear { startUserId = services.auth.session?.userId }
            .onChange(of: services.auth.session?.userId) { _, newValue in
                if newValue != startUserId { dismiss() }
            }
    }
}

/// Round profile avatar: the Jellyfin user image when set, otherwise a tinted
/// initials disc derived from the account's name.
struct ProfileAvatar: View {
    let session: Session
    var size: CGFloat = 34

    private var initials: String {
        let name = session.userName ?? "?"
        let parts = name.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first }
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    private var avatarURL: URL? {
        ImageURLBuilder(session: session)
            .userPrimary(userId: session.userId, maxWidth: Int(size * 3))
    }

    var body: some View {
        ZStack {
            Circle().fill(Color.indigo.opacity(0.35))
            Text(initials)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
            if let avatarURL {
                AsyncImage(url: avatarURL) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

/// iOS Settings-style row: a tinted, fixed-size icon tile + title (+ optional
/// chevron). Keeps the action icons consistently sized and aligned.
private struct SettingsActionRow: View {
    let title: String
    let systemImage: String
    let tint: Color
    var showChevron = false
    var destructive = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(tint, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            Text(title)
                .foregroundStyle(destructive ? Color.red : Color.primary)
            Spacer()
            if showChevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .contentShape(Rectangle())
    }
}
