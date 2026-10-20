import SwiftUI
import StrataKit
import StrataDesign

/// First run and "Add server": servers found on the network, or a typed
/// address, then sign-in.
struct ConnectView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    var isAddingServer = false

    @State private var address = ""
    @State private var probing: String?
    @State private var error: String?
    @State private var signInTarget: SignInTarget?

    struct SignInTarget: Identifiable, Hashable {
        let address: String
        let name: String
        var id: String { address }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space8) {
                    header
                    discovered
                    manual
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, Metrics.space8)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                if isAddingServer {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
            }
            .navigationDestination(item: $signInTarget) { target in
                SignInView(address: target.address, serverName: target.name) {
                    services.refreshClient()
                    if isAddingServer { dismiss() }
                }
            }
        }
        .onAppear { services.browser.start() }
        .onDisappear { services.browser.stop() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            StrataMark().frame(height: 44)
            Text(isAddingServer ? "Add a server" : "Connect to Strata")
                .font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
            Text("Servers on your network appear automatically.")
                .font(.stCallout).foregroundStyle(Theme.ink2)
        }
    }

    @ViewBuilder private var discovered: some View {
        let servers = services.browser.servers.filter { found in !services.store.servers.contains { $0.id == found.id } || !isAddingServer }
        VStack(alignment: .leading, spacing: Metrics.space3) {
            Text("On your network").eyebrowStyle()
            VStack(spacing: 0) {
                if servers.isEmpty {
                    HStack(spacing: Metrics.space3) {
                        if services.browser.state == .denied {
                            Image(systemName: "wifi.exclamationmark").foregroundStyle(Theme.warning)
                            Text("Allow Local Network access in Settings to find servers automatically.")
                        } else {
                            ProgressView()
                            Text("Looking for servers…")
                        }
                    }
                    .font(.stCallout)
                    .foregroundStyle(Theme.ink2)
                    .padding(Metrics.space4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(servers) { server in
                    Button {
                        Task { await probe(server.url.absoluteString) }
                    } label: {
                        HStack(spacing: Metrics.space3) {
                            Image(systemName: "server.rack")
                                .foregroundStyle(Theme.ink2)
                                .frame(width: 36, height: 36)
                                .background(Theme.surface3, in: RoundedRectangle(cornerRadius: Metrics.radiusSM, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(server.name).font(.stHeadline).foregroundStyle(Theme.ink)
                                Text([server.url.host(), server.version.map { "v\($0)" }].compactMap { $0 }.joined(separator: " · "))
                                    .font(.stFootnote).foregroundStyle(Theme.ink3)
                            }
                            Spacer()
                            if probing == server.url.absoluteString {
                                ProgressView()
                            } else if !server.isCompatible {
                                Text("Update needed").font(.stFootnote).foregroundStyle(Theme.warning)
                            } else {
                                Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
                            }
                        }
                        .padding(Metrics.space4)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(probing != nil)
                    if server.id != servers.last?.id { Divider().overlay(Theme.hairline).padding(.leading, 64) }
                }
            }
            .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
        }
    }

    private var manual: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            Text("Server address").eyebrowStyle()
            TextField("192.168.1.20 or strata.example.com", text: $address)
                .textContentType(.URL)
                #if os(iOS)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .onSubmit { Task { await probe(address) } }
                #if !os(tvOS)
                .padding(.horizontal, Metrics.space4)
                .frame(minHeight: 48)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Metrics.radiusSM, style: .continuous))
                #endif
            Text("Port 8420 is added if you leave it out.").font(.stFootnote).foregroundStyle(Theme.ink3)
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.stFootnote).foregroundStyle(Theme.danger)
            }
            PrimaryButton("Continue", isLoading: probing == address && !address.isEmpty) {
                Task { await probe(address) }
            }
            .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || probing != nil)
        }
    }

    private func probe(_ value: String) async {
        probing = value
        error = nil
        defer { probing = nil }
        do {
            let (url, info) = try await services.store.probeServer(value)
            if info.setupRequired {
                error = "\(info.serverName) isn't set up yet. Open \(url.absoluteString) in a browser to finish setup, then try again."
                return
            }
            signInTarget = SignInTarget(address: url.absoluteString, name: info.serverName)
        } catch {
            self.error = StrataError.wrap(error).message
        }
    }
}

struct SignInView: View {
    @Environment(AppServices.self) private var services
    let address: String
    let serverName: String
    let onSignedIn: () -> Void

    @State private var username = ""
    @State private var password = ""
    @FocusState private var field: Field?
    enum Field { case username, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space6) {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    Text("Sign in to \(serverName)").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    Text(address).font(.stFootnote).foregroundStyle(Theme.ink3)
                }
                VStack(spacing: Metrics.space3) {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .focused($field, equals: .username)
                        .submitLabel(.next)
                        .onSubmit { field = .password }
                        .modifier(FieldStyle())
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($field, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await signIn() } }
                        .modifier(FieldStyle())
                }
                if let error = services.store.lastError {
                    Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                }
                PrimaryButton("Sign In", isLoading: services.store.isAuthenticating) {
                    Task { await signIn() }
                }
                .disabled(username.isEmpty || password.isEmpty || services.store.isAuthenticating)
            }
            .frame(maxWidth: 480, alignment: .leading)
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, Metrics.space8)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg.ignoresSafeArea())
        .onAppear { field = .username }
    }

    private func signIn() async {
        if await services.store.signIn(address: address, username: username, password: password) {
            onSignedIn()
        }
    }
}

struct FieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        #if os(tvOS)
        content
        #else
        content
            .padding(.horizontal, Metrics.space4)
            .frame(minHeight: 48)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Metrics.radiusSM, style: .continuous))
        #endif
    }
}
