import SwiftUI
import StrataKit
import StrataDesign

#if os(tvOS)
/// TV sign-in (RFC 8628 device code): a QR code of the server's link page that a signed-in
/// phone opens to approve this TV, with the code spelled out for typing in instead. The TV
/// is then signed in as that account, in its household, able only to watch. Password
/// sign-in stays one click away.
struct TVCodeSignInView: View {
    @Environment(AppServices.self) private var services
    let target: ServerTarget
    let onSignedIn: () -> Void
    /// A code already got for this TV (the phone that sent the server is approving it).
    var initialCode: DeviceCode? = nil

    @State private var code: DeviceCode?
    @State private var error: String?
    @State private var notice: String?
    /// Bumped to fetch a fresh code (the old one expired or was declined).
    @State private var attempt = 0
    @State private var usePassword = false

    var body: some View {
        HStack(alignment: .center, spacing: Metrics.space20) {
            VStack(alignment: .leading, spacing: Metrics.space10) {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text("Sign in to \(target.info.serverName)").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    Text(initialCode == nil ? "Scan the code with your phone's camera and approve this TV from your profile."
                         : "Approve this TV on your phone. Check the code there matches this one.")
                        .font(.stBody).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let code {
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        Text("Or enter this code in Strata on your phone, in Settings › Link a TV")
                            .font(.stCallout).foregroundStyle(Theme.ink3)
                        Text(code.displayCode)
                            .font(.system(size: 64, weight: .semibold, design: .monospaced))
                            .tracking(4)
                            .foregroundStyle(Theme.ink)
                            .accessibilityLabel("Code \(code.displayCode.map(String.init).joined(separator: " "))")
                    }
                }
                if let notice {
                    Label(notice, systemImage: "info.circle").font(.stCallout).foregroundStyle(Theme.ink2)
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").font(.stCallout).foregroundStyle(Theme.danger)
                }
                Button("Use Password Instead") { usePassword = true }
            }
            .frame(maxWidth: 820, alignment: .leading)

            Group {
                if let code, let url = code.qrURL(server: target.url) {
                    QRCodeView(url.absoluteString, size: 440)
                } else {
                    RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous)
                        .fill(Theme.surface1)
                        .frame(width: 440 * 1.12, height: 440 * 1.12)
                        .overlay { if error == nil { ProgressView() } }
                }
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .navigationDestination(isPresented: $usePassword) {
            SignInView(target: target, onSignedIn: onSignedIn)
        }
        .task(id: attempt) { await run() }
    }

    /// Gets a code, then polls at the server's interval until a phone approves it. An
    /// expired or declined code is replaced with a new one; the loop ends when the view
    /// goes away.
    private func run() async {
        let client = StrataClient(baseURL: target.url, cacheTTL: 0)
        do {
            let fresh: DeviceCode
            if attempt == 0, let initialCode { fresh = initialCode } else { fresh = try await client.startDeviceCode() }
            code = fresh
            error = nil
            var interval = max(1, fresh.interval)
            let expires = Date().addingTimeInterval(TimeInterval(fresh.expiresIn))
            while !Task.isCancelled {
                try await Task.sleep(for: .seconds(interval))
                if Date() >= expires { attempt += 1; return }
                let poll: DeviceTokenPoll
                do {
                    poll = try await client.pollDeviceCode(fresh.deviceCode)
                } catch let e as StrataError where e.kind == .network {
                    continue // a dropped poll: try again next tick
                }
                switch poll {
                case .pending:
                    continue
                case .slowDown:
                    interval += 5
                case .approved(let token):
                    if await services.store.signIn(token: token, url: target.url, info: target.info) {
                        onSignedIn()
                    } else {
                        error = services.store.lastError
                    }
                    return
                case .expired:
                    attempt += 1
                    return
                case .denied:
                    notice = "That sign-in was declined on the phone. Here's a new code."
                    attempt += 1
                    return
                }
            }
        } catch is CancellationError {
            return
        } catch {
            self.error = StrataError.wrap(error).message
            try? await Task.sleep(for: .seconds(5))
            if !Task.isCancelled { attempt += 1 }
        }
    }
}

/// "Sign In with Your Phone": a QR code for a phone already signed in to Strata. The phone
/// finds this TV on the network and sends it the server (nothing typed on either), the TV
/// gets a sign-in code from that server, and the phone approves it.
struct TVPhoneSignInView: View {
    @Environment(AppServices.self) private var services
    let onSignedIn: () -> Void

    @State private var host = TVLinkHost()
    @State private var linked: Linked?
    @State private var error: String?

    struct Linked: Hashable {
        let target: ServerTarget
        let code: DeviceCode
    }

    var body: some View {
        HStack(alignment: .center, spacing: Metrics.space20) {
            VStack(alignment: .leading, spacing: Metrics.space10) {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text("Sign in with your phone").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    Text("Scan the code with the camera on a phone that's signed in to Strata. It sends this TV its server, then asks you to approve.")
                        .font(.stBody).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("The phone needs to be on the same Wi-Fi as this TV.")
                        .font(.stCallout).foregroundStyle(Theme.ink3)
                }
                if let message = error ?? host.failure {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.stCallout).foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: 820, alignment: .leading)

            QRCodeView(TVLink.url(key: host.key).absoluteString, size: 440)
        }
        .padding(.horizontal, Metrics.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .navigationDestination(item: $linked) { linked in
            TVCodeSignInView(target: linked.target, onSignedIn: onSignedIn, initialCode: linked.code)
        }
        .onAppear {
            host.onOffer = { addresses in try await offer(addresses) }
            host.start()
        }
        .onDisappear { host.stop() }
    }

    /// The phone sent its server's addresses: reach one, get a sign-in code from it, and
    /// hand the code back for the phone to approve.
    private func offer(_ addresses: [String]) async throws -> String {
        error = nil
        var lastError: Error?
        for address in addresses {
            do {
                let (url, info) = try await services.store.probeServer(address)
                let code = try await StrataClient(baseURL: url, cacheTTL: 0).startDeviceCode()
                linked = Linked(target: ServerTarget(url: url, info: info), code: code)
                return code.userCode
            } catch {
                lastError = error
            }
        }
        let message = "This TV can't reach your phone's server. \(lastError.map { StrataError.wrap($0).message } ?? "")"
            .trimmingCharacters(in: .whitespaces)
        error = message
        throw StrataError(kind: .network, message: message)
    }
}
#endif

/// Phone side: confirms and approves a TV's sign-in code, from the TV's QR code opened in
/// the app (`request` set) or typed in from Settings (`request` nil). The TV is signed in
/// as the account approving it, in its current household, and can only watch.
struct ApproveDeviceView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    var request: LinkRequest?

    @State private var typedCode = ""
    @State private var looked: DeviceCodeStatus?
    @State private var phase: Phase = .idle
    @State private var error: String?

    enum Phase { case idle, looking, approving, done, denied }

    /// The sign-in that approves: on the server the link names, the active one if it's
    /// there, else the first saved on that server. Never a server this device hasn't
    /// signed in to (a QR code could name any address).
    private var signIn: SavedSignIn? {
        let store = services.store
        guard let named = request?.server else { return store.active }
        guard let server = store.savedServer(matching: named) else { return nil }
        if let active = store.active, active.serverID == server.id { return active }
        return store.signIns(onServer: server.id).first
    }
    private var server: SavedServer? { signIn.flatMap { services.store.server(for: $0) } }
    private var client: StrataClient? { signIn.flatMap { services.store.client(forSignIn: $0.id) } }
    private var code: String { DeviceCode.normalize(request?.code ?? typedCode) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Metrics.space6) {
                content
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, Metrics.space6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Link a TV")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(phase == .done || phase == .denied ? "Done" : "Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task { if request != nil { await lookUp() } }
    }

    @ViewBuilder private var content: some View {
        if client == nil {
            MessageView(systemImage: "server.rack", title: "Not signed in to that server",
                        message: "Sign in on this phone to the server your TV is using, then scan the code again.")
        } else if phase == .done {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(Theme.success)
                Text("Your TV is signed in").font(.stTitle2).foregroundStyle(Theme.ink)
                Text("It's watching as \(signIn?.name ?? "you").")
                    .font(.stCallout).foregroundStyle(Theme.ink2)
            }
        } else if phase == .denied {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                Image(systemName: "xmark.circle.fill").font(.system(size: 44)).foregroundStyle(Theme.ink3)
                Text("Sign-in declined").font(.stTitle2).foregroundStyle(Theme.ink)
                Text("The TV wasn't signed in.").font(.stCallout).foregroundStyle(Theme.ink2)
            }
        } else if looked != nil {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                Text("Approve this TV?").font(.stTitle2).foregroundStyle(Theme.ink)
                Text("It will watch as \(signIn?.name ?? "you") on \(server?.name ?? "this server"), and can't change settings.")
                    .font(.stCallout).foregroundStyle(Theme.ink2)
            }
            // Someone could show you a code for their own device; matching the code on
            // your screen is what proves it's yours.
            VStack(alignment: .leading, spacing: Metrics.space2) {
                Text("Check that your TV shows this code").font(.stFootnote).foregroundStyle(Theme.ink3)
                Text(DeviceCode.display(code))
                    .font(.system(.title, design: .monospaced).weight(.semibold))
                    .tracking(2)
                    .foregroundStyle(Theme.ink)
            }
            .padding(Metrics.space4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
            errorLabel
            PrimaryButton("Approve", isLoading: phase == .approving) { Task { await approve() } }
                .disabled(phase == .approving)
            Button("Decline", role: .destructive) { Task { await deny() } }
                .disabled(phase == .approving)
                .frame(maxWidth: .infinity)
        } else {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                Text("Enter the code shown on your TV. It will be signed in to \(server?.name ?? "this server") as \(signIn?.name ?? "you").")
                    .font(.stCallout).foregroundStyle(Theme.ink2)
                if request == nil {
                    TextField("K7QF-2MXD", text: $typedCode)
                        .font(.system(.title2, design: .monospaced).weight(.semibold))
                        #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        #endif
                        .autocorrectionDisabled()
                        .submitLabel(.continue)
                        .onSubmit { Task { await lookUp() } }
                        .modifier(FieldStyle())
                }
            }
            errorLabel
            if request == nil {
                PrimaryButton("Continue", isLoading: phase == .looking) { Task { await lookUp() } }
                    .disabled(code.count < 8 || phase == .looking)
            } else if phase == .looking {
                ProgressView()
            }
        }
    }

    @ViewBuilder private var errorLabel: some View {
        if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
        }
    }

    /// Opens the code, which also claims it for this account so it can be approved.
    private func lookUp() async {
        guard let client, !code.isEmpty else { return }
        phase = .looking
        error = nil
        defer { if phase == .looking { phase = .idle } }
        do {
            let status = try await client.deviceCodeStatus(userCode: code)
            if status.isPending {
                looked = status
            } else {
                error = "That code was already used. Ask the TV for a new one."
            }
        } catch {
            self.error = Self.message(error)
        }
    }

    private func approve() async {
        guard let client else { return }
        phase = .approving
        error = nil
        do {
            try await client.approveDevice(userCode: code)
            phase = .done
        } catch {
            self.error = Self.message(error)
            phase = .idle
        }
    }

    private func deny() async {
        guard let client else { return }
        try? await client.denyDevice(userCode: code)
        phase = .denied
    }

    private static func message(_ error: Error) -> String {
        let e = StrataError.wrap(error)
        switch e.code {
        case "invalid_request" where e.message.localizedCaseInsensitiveContains("invalid user code"):
            return "There's no such code. Check it against the one on your TV."
        case "expired_token":
            return "That code has expired. The TV shows a new one."
        default:
            return e.message
        }
    }
}

#if os(iOS)
/// Phone side of a TV's "Sign in with your phone" code: finds the TV on the network, sends
/// it this phone's server, then approves the sign-in code the TV got from it.
struct PhoneLinkTVView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let request: TVLinkRequest

    @State private var code: String?
    @State private var error: String?
    @State private var attempt = 0

    var body: some View {
        if let code, let server = services.store.activeServer {
            ApproveDeviceView(request: LinkRequest(code: code, server: server.id))
        } else {
            NavigationStack {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    if let error {
                        MessageView(systemImage: "appletv", title: "Couldn't sign in your TV", message: error, actionTitle: "Try Again") {
                            attempt += 1
                        }
                    } else {
                        HStack(spacing: Metrics.space3) {
                            ProgressView()
                            Text("Finding your TV…").font(.stCallout).foregroundStyle(Theme.ink2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, Metrics.space6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.bg.ignoresSafeArea())
                .navigationTitle("Link a TV")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
            }
            .presentationDetents([.medium, .large])
            .task(id: attempt) { await link() }
        }
    }

    private func link() async {
        error = nil
        guard let server = services.store.activeServer else {
            error = "Sign in on this phone first."
            return
        }
        do {
            code = try await TVLinkClient.link(key: request.key, addresses: server.addresses)
        } catch is CancellationError {
            return
        } catch {
            self.error = StrataError.wrap(error).message
        }
    }
}
#endif
