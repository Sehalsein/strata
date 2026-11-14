import SwiftUI
import StrataKit
import StrataDesign

/// A server picked on the Connect screen, ready to sign in to.
struct ServerTarget: Identifiable, Hashable {
    let url: URL
    let info: ServerInfo
    var id: String { url.absoluteString }
}

/// First run and "Add Profile": servers this device knows or finds on the network, or a
/// typed address; then, on a home network, who's watching (no password), otherwise
/// sign-in (a code approved from a phone on a TV).
struct ConnectView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    /// Adding another account (as a sheet over the app or "Who's watching?").
    var isAdding = false
    /// Called once an account is added (after this sheet dismisses itself).
    var onAdded: () -> Void = {}

    @State private var address = ""
    @State private var probing: String?
    @State private var error: String?
    @State private var signInTarget: ServerTarget?
    @State private var joinTarget: ServerTarget?
    @State private var showAddressEntry = false
    /// TV: a phone already signed in sends the server; nothing typed.
    @State private var showPhoneSignIn = false
    /// The camera (or a pasted link): a member's sign-in code or a server's address.
    @State private var scanning = false
    @State private var scannedSignIn: SignInCodeRequest?
    /// Servers appear a moment after the screen; on tvOS focus moves to the first one
    /// (otherwise it sits on "Enter Address", the only button at first).
    @FocusState private var focusedServer: String?

    #if os(tvOS)
    static let columnWidth: CGFloat = 960
    #else
    static let columnWidth: CGFloat = 560
    #endif

    var body: some View {
        NavigationStack {
            Group {
            #if os(tvOS)
            // Laid out like Settings: what this is on the left, the ways in on the right.
            TVSettingsPage {
                header.padding(.top, Metrics.space12)
            } content: {
                tvOptions
            }
            #else
            ScrollView {
                VStack(alignment: Self.alignment, spacing: Metrics.space8) {
                    header
                    scanButton
                    serverList
                    addressEntry
                }
                .frame(maxWidth: Self.columnWidth, alignment: Self.frameAlignment)
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, Metrics.space12)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(Theme.bg.ignoresSafeArea())
            #endif
            }
            .toolbar {
                if isAdding {
                    ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel", bundle: .module)) { dismiss() } }
                }
            }
            .navigationDestination(item: $signInTarget) { target in
                #if os(tvOS)
                // Typing a password with the remote is slow; scanning a code with a phone isn't.
                TVCodeSignInView(target: target, onSignedIn: signedIn)
                #else
                SignInView(target: target, onSignedIn: signedIn)
                #endif
            }
            .navigationDestination(item: $joinTarget) { target in
                JoinMemberPickerView(target: target, onSignedIn: signedIn)
            }
            #if os(tvOS)
            .navigationDestination(isPresented: $showPhoneSignIn) {
                TVPhoneSignInView(onSignedIn: signedIn)
            }
            .navigationDestination(isPresented: $showAddressEntry) {
                tvAddressEntry
            }
            #endif
        }
        #if os(iOS)
        .sheet(isPresented: $scanning) {
            QRScannerSheet { text in handleScan(text) }
        }
        .sheet(item: $scannedSignIn) { request in
            SignInCodeView(request: request, onSignedIn: signedIn)
        }
        #endif
        .onAppear { services.browser.start() }
        #if DEBUG
        // `-StrataServer 127.0.0.1:8460` connects at launch, for UI tests and screenshots
        // (typing an address with a remote is slow to script).
        .task {
            #if os(tvOS)
            // `-StrataPhoneSignIn YES` opens "Sign In with Your Phone".
            if !isAdding, UserDefaults.standard.bool(forKey: "StrataPhoneSignIn") { showPhoneSignIn = true }
            #endif
            guard !isAdding, let preset = UserDefaults.standard.string(forKey: "StrataServer"), !preset.isEmpty else { return }
            address = preset
            await probe(preset)
        }
        #endif
        .onDisappear { services.browser.stop() }
        .onChange(of: rows.first?.id) { _, first in
            if focusedServer == nil { focusedServer = first }
        }
    }

    private func signedIn() {
        services.refreshClient()
        if isAdding {
            dismiss()
            onAdded()
        }
    }

    #if os(tvOS)
    private static let alignment = HorizontalAlignment.center
    private static let frameAlignment = Alignment.center
    #else
    private static let alignment = HorizontalAlignment.leading
    private static let frameAlignment = Alignment.leading
    #endif

    private static func subtitle(isAdding: Bool) -> String {
        #if os(iOS)
        isAdding ? String(localized: "Scan a code from your admin, or pick the server it's on.", bundle: .module) : String(localized: "Scan a code from your admin, or pick a server on your network.", bundle: .module)
        #else
        isAdding ? String(localized: "Choose the server the profile is on.", bundle: .module) : String(localized: "Choose how to sign in this Apple TV.", bundle: .module)
        #endif
    }

    private var header: some View {
        VStack(alignment: Self.alignment, spacing: Metrics.space3) {
            #if os(tvOS)
            StrataMark().frame(height: 140).padding(.bottom, Metrics.space10)
            #else
            StrataMark().frame(height: 44).padding(.bottom, Metrics.space2)
            #endif
            Text(isAdding ? String(localized: "Add a profile", bundle: .module) : String(localized: "Connect to Strata", bundle: .module))
                .font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
            Text(Self.subtitle(isAdding: isAdding))
                .font(.stCallout).foregroundStyle(Theme.ink2)
                .multilineTextAlignment(Self.alignment == .center ? .center : .leading)
        }
    }

    #if os(tvOS)
    /// Servers on the network first (usually one, and the quickest way in), then the two
    /// ways in that don't need one found: a phone that's signed in, or a typed address.
    /// System rows, as in Settings, which turn white with dark text when focused.
    private var tvOptions: some View {
        Form {
            Section {
                if rows.isEmpty {
                    HStack(spacing: Metrics.space4) {
                        if services.browser.state == .denied {
                            Image(systemName: "wifi.exclamationmark").foregroundStyle(Theme.warning)
                            Text("Allow Local Network access in Settings to find servers automatically.", bundle: .module)
                        } else {
                            ProgressView()
                            Text("Looking for servers…", bundle: .module)
                        }
                    }
                    .foregroundStyle(.secondary)
                    .focusable()
                }
                ForEach(rows) { server in
                    Button {
                        Task { await probe(server.url.absoluteString) }
                    } label: {
                        optionLabel(server.name, detail: Self.address(server.url), systemImage: "server.rack") {
                            if probing == server.url.absoluteString {
                                ProgressView()
                            } else if !server.isCompatible {
                                Text("Update needed", bundle: .module).foregroundStyle(Theme.warning)
                            }
                        }
                    }
                    .focused($focusedServer, equals: server.id)
                    .disabled(probing != nil)
                    .contextMenu {
                        // Off this list on this device; signing in to it again brings it back.
                        Button(role: .destructive) { services.store.hideServer(server.id) } label: {
                            Label(String(localized: "Remove from List", bundle: .module), systemImage: "minus.circle")
                        }
                    }
                }
                if !rows.isEmpty {
                    // Right under the servers it takes off the list; hidden ones can come back.
                    Button {
                        services.store.hideServers(rows.map(\.id))
                    } label: {
                        Label(rows.count == 1 ? String(localized: "Remove This Server from List", bundle: .module)
                                              : String(localized: "Remove These Servers from List", bundle: .module),
                              systemImage: "minus.circle")
                    }
                    .disabled(probing != nil)
                }
                let hidden = services.store.hiddenServerIDs.count
                if hidden > 0 {
                    Button {
                        services.store.showHiddenServers()
                    } label: {
                        Label(String(localized: "Show \(hidden) Hidden Servers", bundle: .module), systemImage: "eye")
                    }
                }
            } header: {
                Text("On your network", bundle: .module)
            } footer: {
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.danger)
                } else if !rows.isEmpty {
                    Text("Removing a server only hides it on this Apple TV. Signing in to it again brings it back.", bundle: .module)
                }
            }
            Section {
                Button { showPhoneSignIn = true } label: {
                    optionLabel(String(localized: "Sign In with Your Phone", bundle: .module),
                                detail: String(localized: "Scan a code. Nothing to type.", bundle: .module), systemImage: "iphone") { EmptyView() }
                }
                .disabled(probing != nil)
                Button { showAddressEntry = true } label: {
                    optionLabel(String(localized: "Enter Address", bundle: .module),
                                detail: String(localized: "Type the server's address.", bundle: .module), systemImage: "keyboard") { EmptyView() }
                }
                .disabled(probing != nil)
            } header: {
                Text(rows.isEmpty ? String(localized: "Or sign in another way", bundle: .module) : String(localized: "Other ways to sign in", bundle: .module))
            }
        }
    }

    /// A Settings-style row: symbol, title and a line under it, with an accessory at the end.
    private func optionLabel(_ title: String, detail: String, systemImage: String, @ViewBuilder accessory: () -> some View) -> some View {
        HStack(spacing: Metrics.space5) {
            Image(systemName: systemImage).frame(width: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.stFootnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: Metrics.space4)
            accessory()
        }
        .padding(.vertical, Metrics.space2)
    }

    /// The address, on its own screen: the remote's keyboard takes over the bottom half.
    private var tvAddressEntry: some View {
        VStack(spacing: Metrics.space10) {
            VStack(spacing: Metrics.space3) {
                Image(systemName: "keyboard")
                    .font(.system(size: 44, weight: .medium))
                    .foregroundStyle(Theme.accentText)
                    .padding(.bottom, Metrics.space2)
                Text("Enter the server address", bundle: .module).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                Text("It's on the server's dashboard, like 192.168.1.20 or strata.example.com.", bundle: .module)
                    .font(.stCallout).foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
            }
            addressEntry.frame(width: 760)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
    }
    #endif

    /// A server to offer: one this device already uses, or one found on the network.
    private struct Row: Identifiable {
        let id: String
        let name: String
        let url: URL
        var isCompatible = true
    }

    /// Saved servers, then ones found on the network, without those taken off the list.
    private var rows: [Row] {
        let saved = services.store.servers.map { Row(id: $0.id, name: $0.name, url: $0.url) }
        let found = services.browser.servers
            .filter { found in !saved.contains { $0.id == found.id } }
            .map { Row(id: $0.id, name: $0.name, url: $0.url, isCompatible: $0.isCompatible) }
        return (saved + found).filter { !services.store.hiddenServerIDs.contains($0.id) }
    }

    @ViewBuilder private var serverList: some View {
        VStack(spacing: Self.rowSpacing) {
            if rows.isEmpty {
                HStack(spacing: Metrics.space3) {
                    if services.browser.state == .denied {
                        Image(systemName: "wifi.exclamationmark").foregroundStyle(Theme.warning)
                        Text("Allow Local Network access in Settings to find servers automatically.", bundle: .module)
                    } else {
                        ProgressView()
                        Text("Looking for servers…", bundle: .module)
                    }
                }
                .font(.stCallout)
                .foregroundStyle(Theme.ink2)
                #if os(tvOS)
                .padding(Metrics.space6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
                #else
                .frame(maxWidth: .infinity, alignment: Self.frameAlignment)
                .padding(.vertical, Metrics.space4)
                #endif
            }
            ForEach(rows) { server in
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
                .contextMenu {
                    // Off this list on this device; signing in to it again brings it back.
                    Button(role: .destructive) { services.store.hideServer(server.id) } label: {
                        Label(String(localized: "Remove from List", bundle: .module), systemImage: "minus.circle")
                    }
                }
            }
            listActions
        }
    }

    /// "Clear List" takes every server shown off the list; hidden ones can come back.
    @ViewBuilder private var listActions: some View {
        let hidden = services.store.hiddenServerIDs.count
        if !rows.isEmpty || hidden > 0 {
            HStack(spacing: Metrics.space6) {
                if !rows.isEmpty {
                    Button(String(localized: "Clear List", bundle: .module)) { services.store.hideServers(rows.map(\.id)) }
                }
                if hidden > 0 {
                    Button(String(localized: "Show \(hidden) Hidden Servers", bundle: .module)) { services.store.showHiddenServers() }
                }
            }
            #if os(tvOS)
            .font(.stFootnote)
            .buttonStyle(.borderless)
            .frame(maxWidth: .infinity, alignment: .trailing)
            #else
            .font(.stCallout)
            .buttonStyle(.plain)
            .foregroundStyle(Theme.accentText)
            .frame(maxWidth: .infinity, alignment: Self.frameAlignment)
            #endif
            .padding(.top, Metrics.space1)
        }
    }

    /// The host, with the port when it isn't Strata's usual one (two servers on one machine).
    private static func address(_ url: URL) -> String {
        guard let host = url.host() else { return url.absoluteString }
        guard let port = url.port, port != 8420 else { return host }
        return "\(host):\(port)"
    }

    #if os(tvOS)
    private static let rowSpacing = Metrics.space6
    private static let iconSize: CGFloat = 72
    private static let rowPadding = Metrics.space6
    #else
    private static let rowSpacing = Metrics.space2
    private static let iconSize: CGFloat = 44
    private static let rowPadding = Metrics.space4
    #endif

    private func serverRow(_ server: Row) -> some View {
        HStack(spacing: Metrics.space4) {
            Image(systemName: "server.rack")
                #if os(tvOS)
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(Theme.accentText)
                #else
                .font(.stHeadline)
                .foregroundStyle(Theme.ink2)
                #endif
                .frame(width: Self.iconSize, height: Self.iconSize)
                .background(Theme.surface3, in: RoundedRectangle(cornerRadius: Self.iconSize > 44 ? Metrics.radiusMD : Metrics.radiusSM, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(server.name).font(.stHeadline).foregroundStyle(Theme.ink)
                Text(Self.address(server.url)).font(.stFootnote).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: Metrics.space2)
            if probing == server.url.absoluteString {
                ProgressView()
            } else if !server.isCompatible {
                Text("Update needed", bundle: .module).font(.stFootnote).foregroundStyle(Theme.warning)
            } else {
                Image(systemName: "chevron.right").font(.stFootnote.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
        }
        .padding(Self.rowPadding)
        .contentShape(Rectangle())
    }

    #if os(iOS)
    /// The quickest way in: a sign-in code from the dashboard signs this profile in; the
    /// server's address code just finds the server.
    private var scanButton: some View {
        Button {
            error = nil
            scanning = true
        } label: {
            HStack(spacing: Metrics.space4) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.stHeadline)
                    .foregroundStyle(Theme.onAccent)
                    .frame(width: 44, height: 44)
                    .background(Theme.apricot, in: RoundedRectangle(cornerRadius: Metrics.radiusSM, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Scan QR Code", bundle: .module).font(.stHeadline).foregroundStyle(Theme.ink)
                    Text("Sign-in code or server address", bundle: .module)
                        .font(.stFootnote).foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: Metrics.space2)
                Image(systemName: "chevron.right").font(.stFootnote.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .padding(Metrics.space4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
    }

    private func handleScan(_ text: String) {
        switch ScannedCode(text) {
        case .signIn(let request):
            // After the scanner's sheet has gone.
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(450))
                scannedSignIn = request
            }
        case .server(let address):
            self.address = address
            Task { await probe(address) }
        case .tvLink:
            error = String(localized: "That's a TV's code. To sign a TV in, open Settings › Link a TV.", bundle: .module)
        case .tvPhoneLink:
            error = String(localized: "That's a TV's code. Sign in on this phone first, then scan it again to sign the TV in.", bundle: .module)
        case .unknown:
            error = String(localized: "That QR code isn't from Strata. Scan a sign-in code from Members, or the server's address.", bundle: .module)
        }
    }
    #endif

    private var addressEntry: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            TextField(String(localized: "Server address", bundle: .module), text: $address, prompt: Text("Server address, like 192.168.1.20", bundle: .module))
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
                PrimaryButton(String(localized: "Continue", bundle: .module), isLoading: probing == address) {
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
        services.store.lastError = nil
        defer { probing = nil }
        do {
            let (url, info) = try await services.store.probeServer(value)
            if info.setupRequired {
                let code = info.setupCodeRequired == false ? "" : String(localized: " You'll need the setup code from the server's log.", bundle: .module)
                error = String(localized: "\(info.serverName) isn't set up yet. Open \(url.absoluteString) in a browser to create the first account, then try again.\(code)", bundle: .module)
                return
            }
            let target = ServerTarget(url: url, info: info)
            // On the server's home network there's no password: pick who's watching.
            if info.localJoin == true {
                joinTarget = target
            } else {
                signInTarget = target
            }
        } catch {
            self.error = StrataError.wrap(error).message
        }
    }
}

/// Username (or email) and password.
struct SignInView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.openURL) private var openURL
    let target: ServerTarget
    let onSignedIn: () -> Void

    @State private var login = ""
    @State private var password = ""
    @FocusState private var field: Field?
    enum Field { case login, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space6) {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    Text("Sign in to \(target.info.serverName)", bundle: .module).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    Text("Sign in with your Strata username and password. New here? Ask whoever runs this server for an invite.", bundle: .module)
                        .font(.stCallout).foregroundStyle(Theme.ink2)
                }
                VStack(spacing: Metrics.space3) {
                    TextField(String(localized: "Username or email", bundle: .module), text: $login)
                        .textContentType(.username)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                        .autocorrectionDisabled()
                        .focused($field, equals: .login)
                        .submitLabel(.next)
                        .onSubmit { field = .password }
                        .modifier(FieldStyle())
                    SecureField(String(localized: "Password", bundle: .module), text: $password)
                        .textContentType(.password)
                        .focused($field, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await signIn() } }
                        .modifier(FieldStyle())
                }
                if let error = services.store.lastError {
                    Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                }
                PrimaryButton(String(localized: "Sign In", bundle: .module), isLoading: services.store.isAuthenticating) {
                    Task { await signIn() }
                }
                .disabled(login.isEmpty || password.isEmpty || services.store.isAuthenticating)
                #if os(iOS)
                // The server emails a reset link; its page asks for the address.
                if target.info.signIn?.passwordReset == true {
                    Button(String(localized: "Forgot password?", bundle: .module)) { openURL(target.url.appending(path: "forgot-password")) }
                        .font(.stFootnote)
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.accentText)
                        .frame(maxWidth: .infinity)
                }
                #endif
            }
            .frame(maxWidth: 480, alignment: .leading)
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, Metrics.space8)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg.ignoresSafeArea())
        .onAppear {
            services.store.lastError = nil
            field = .login
        }
    }

    private func signIn() async {
        guard !login.isEmpty, !password.isEmpty else { return }
        if await services.store.signIn(address: target.url.absoluteString, login: login, password: password) {
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
