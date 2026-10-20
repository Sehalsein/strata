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
    @State private var codeTarget: ServerTarget?
    @State private var showAddressEntry = false
    /// Servers appear a moment after the screen; on tvOS focus moves to the first one
    /// (otherwise it sits on "Enter Address", the only button at first).
    @FocusState private var focusedServer: String?

    #if os(tvOS)
    static let columnWidth: CGFloat = 960
    #else
    static let columnWidth: CGFloat = 560
    #endif

    struct SignInTarget: Identifiable, Hashable {
        let address: String
        let name: String
        var id: String { address }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: Self.alignment, spacing: Metrics.space8) {
                    header
                    serverList
                    #if os(tvOS)
                    Button("Enter Address") { showAddressEntry = true }
                    #else
                    addressEntry
                    #endif
                }
                .frame(maxWidth: Self.columnWidth, alignment: Self.frameAlignment)
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, Metrics.space12)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
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
            #if os(tvOS)
            .navigationDestination(item: $codeTarget) { target in
                TVCodeSignInView(target: target) {
                    services.refreshClient()
                    if isAddingServer { dismiss() }
                }
            }
            .navigationDestination(isPresented: $showAddressEntry) {
                VStack(alignment: .leading, spacing: Metrics.space8) {
                    Text("Enter the server address").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    addressEntry
                }
                .frame(maxWidth: Self.columnWidth, alignment: .leading)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.bg.ignoresSafeArea())
            }
            #endif
        }
        .onAppear { services.browser.start() }
        .onDisappear { services.browser.stop() }
        .onChange(of: found.first?.id) { _, first in
            if focusedServer == nil { focusedServer = first }
        }
    }

    #if os(tvOS)
    private static let alignment = HorizontalAlignment.center
    private static let frameAlignment = Alignment.center
    #else
    private static let alignment = HorizontalAlignment.leading
    private static let frameAlignment = Alignment.leading
    #endif

    private var header: some View {
        VStack(alignment: Self.alignment, spacing: Metrics.space3) {
            StrataMark().frame(height: 44).padding(.bottom, Metrics.space2)
            Text(isAddingServer ? "Add a server" : "Connect to Strata")
                .font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
            Text("Pick a server on your network, or enter its address.")
                .font(.stCallout).foregroundStyle(Theme.ink2)
                .multilineTextAlignment(Self.alignment == .center ? .center : .leading)
        }
    }

    private var found: [DiscoveredServer] {
        services.browser.servers.filter { found in !isAddingServer || !services.store.servers.contains { $0.id == found.id } }
    }

    @ViewBuilder private var serverList: some View {
        VStack(spacing: Metrics.space2) {
            if found.isEmpty {
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
                .frame(maxWidth: .infinity, alignment: Self.frameAlignment)
                .padding(.vertical, Metrics.space4)
            }
            ForEach(found) { server in
                Button {
                    Task { await probe(server.url.absoluteString) }
                } label: {
                    serverRow(server)
                }
                #if os(tvOS)
                .buttonStyle(.card)
                .focused($focusedServer, equals: server.id)
                #else
                .buttonStyle(.plain)
                .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
                #endif
                .disabled(probing != nil)
            }
        }
    }

    private func serverRow(_ server: DiscoveredServer) -> some View {
        HStack(spacing: Metrics.space4) {
            Image(systemName: "server.rack")
                .font(.stHeadline)
                .foregroundStyle(Theme.ink2)
                .frame(width: 44, height: 44)
                .background(Theme.surface3, in: RoundedRectangle(cornerRadius: Metrics.radiusSM, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(server.name).font(.stHeadline).foregroundStyle(Theme.ink)
                Text(server.url.host() ?? server.url.absoluteString).font(.stFootnote).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: Metrics.space2)
            if probing == server.url.absoluteString {
                ProgressView()
            } else if !server.isCompatible {
                Text("Update needed").font(.stFootnote).foregroundStyle(Theme.warning)
            } else {
                Image(systemName: "chevron.right").font(.stFootnote.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
        }
        .padding(Metrics.space4)
        .contentShape(Rectangle())
    }

    private var addressEntry: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            TextField("Server address", text: $address, prompt: Text("Server address, like 192.168.1.20"))
                .textContentType(.URL)
                #if os(iOS)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .submitLabel(.continue)
                #endif
                .autocorrectionDisabled()
                .onSubmit { Task { await probe(address) } }
                .modifier(FieldStyle())
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.stFootnote).foregroundStyle(Theme.danger)
            }
            if !address.trimmingCharacters(in: .whitespaces).isEmpty {
                PrimaryButton("Continue", isLoading: probing == address) {
                    Task { await probe(address) }
                }
                .disabled(probing != nil)
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: address.isEmpty)
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
            // On the server's home network there's no password: straight to "Who's watching?".
            if info.localJoin == true {
                if await services.store.join(url: url, info: info) {
                    services.refreshClient()
                    if isAddingServer { dismiss() }
                } else {
                    error = services.store.lastError
                }
                return
            }
            #if os(tvOS)
            // Typing a password with the remote is slow; scanning a code with a phone isn't.
            codeTarget = ServerTarget(url: url, info: info)
            #else
            signInTarget = SignInTarget(address: url.absoluteString, name: info.serverName)
            #endif
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
                    Text("Use the account you created in the server’s dashboard. You’ll pick a profile next.")
                        .font(.stCallout).foregroundStyle(Theme.ink2)
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
