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
        Group {
            if initialCode != nil { approveOnPhone } else { scanToApprove }
        }
        .padding(.horizontal, Metrics.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .navigationDestination(isPresented: $usePassword) {
            SignInView(target: target, onSignedIn: onSignedIn)
        }
        .task(id: attempt) { await run() }
    }

    /// A phone sent this TV its server and is showing the code: only the code matters here.
    private var approveOnPhone: some View {
        VStack(spacing: Metrics.space10) {
            VStack(spacing: Metrics.space3) {
                Image(systemName: "iphone.badge.checkmark")
                    .font(.system(size: 64, weight: .medium))
                    .foregroundStyle(Theme.accentText)
                    .padding(.bottom, Metrics.space3)
                Text("Approve on your phone").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                Text("Signing in to \(target.info.serverName). Check your phone shows the same code.")
                    .font(.stBody).foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
            }
            if let code {
                CodeTiles(code.displayCode, size: .large)
            }
            messages
            WaitingLabel("Waiting for approval…")
        }
        .frame(maxWidth: 1100)
    }

    private var scanToApprove: some View {
        HStack(alignment: .center, spacing: Metrics.space20) {
            VStack(alignment: .leading, spacing: Metrics.space10) {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text("Sign in to \(target.info.serverName)").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    Text("Scan the code with your phone's camera and approve this TV from your profile.")
                        .font(.stBody).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let code {
                    VStack(alignment: .leading, spacing: Metrics.space4) {
                        Text("Or enter this code in Strata on your phone, in Settings › Link a TV")
                            .font(.stCallout).foregroundStyle(Theme.ink3)
                            .fixedSize(horizontal: false, vertical: true)
                        CodeTiles(code.displayCode, size: .large)
                    }
                }
                messages
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
    }

    @ViewBuilder private var messages: some View {
        if let notice {
            Label(notice, systemImage: "info.circle").font(.stCallout).foregroundStyle(Theme.ink2)
        }
        if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill").font(.stCallout).foregroundStyle(Theme.danger)
        }
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
                    Text("Use an iPhone that's already signed in to Strata. Nothing to type.")
                        .font(.stBody).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: Metrics.space6) {
                    Step(number: 1, title: "Scan the code", detail: "Point your iPhone's camera at it.")
                    Step(number: 2, title: "Check the code matches", detail: "Your phone and this TV show the same one.")
                    Step(number: 3, title: "Tap Approve", detail: "This TV signs in as you, to watch.")
                }
                if let message = error ?? host.failure {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.stCallout).foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    WaitingLabel("Waiting for your phone…")
                }
            }
            .frame(maxWidth: 820, alignment: .leading)

            VStack(spacing: Metrics.space5) {
                QRCodeView(TVLink.url(key: host.key).absoluteString, size: 440)
                Label("Same Wi-Fi as this TV", systemImage: "wifi")
                    .font(.stFootnote).foregroundStyle(Theme.ink3)
            }
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
/// One numbered step of a sign-in on the TV.
private struct Step: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Metrics.space5) {
            Text("\(number)")
                .font(.stHeadline.monospacedDigit())
                .foregroundStyle(Theme.onAccent)
                .frame(width: 52, height: 52)
                .background(Theme.apricot, in: Circle())
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 10 }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.stHeadline).foregroundStyle(Theme.ink)
                Text(detail).font(.stCallout).foregroundStyle(Theme.ink3)
            }
        }
    }
}

/// A spinner and what it's waiting for.
private struct WaitingLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        HStack(spacing: Metrics.space4) {
            ProgressView()
            Text(text).font(.stCallout).foregroundStyle(Theme.ink2)
        }
    }
}
#endif

/// The top of a TV-linking sheet: a symbol in a tinted circle, a title and a line under it.
struct LinkHero: View {
    let systemImage: String
    let tint: Color
    let title: String
    let message: String?

    var body: some View {
        VStack(spacing: Metrics.space3) {
            Image(systemName: systemImage)
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 72, height: 72)
                .background(tint.opacity(0.16), in: Circle())
                .padding(.bottom, Metrics.space2)
            Text(title).font(.stTitle2).foregroundStyle(Theme.ink)
            if let message {
                Text(message).font(.stCallout).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, Metrics.space4)
    }
}

/// A sign-in code as a row of tiles, one per character, so it's quick to compare on a TV
/// and a phone side by side. The dash between halves stays a gap.
struct CodeTiles: View {
    enum Size { case regular, large }
    let code: String
    let size: Size

    init(_ code: String, size: Size = .regular) {
        self.code = code
        self.size = size
    }

    private var tile: CGSize { size == .large ? CGSize(width: 84, height: 104) : CGSize(width: 34, height: 46) }
    private var font: Font {
        .system(size: size == .large ? 56 : 24, weight: .semibold, design: .monospaced)
    }
    private var gap: CGFloat { size == .large ? Metrics.space3 : Metrics.space1 + 2 }

    var body: some View {
        HStack(spacing: gap * 2.5) {
            ForEach(Array(code.split(separator: "-").enumerated()), id: \.offset) { _, group in
                HStack(spacing: gap) {
                    ForEach(Array(group.enumerated()), id: \.offset) { _, char in
                        Text(String(char))
                            .font(font)
                            .foregroundStyle(Theme.ink)
                            .frame(width: tile.width, height: tile.height)
                            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: size == .large ? Metrics.radiusMD : Metrics.radiusXS + 2, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: size == .large ? Metrics.radiusMD : Metrics.radiusXS + 2, style: .continuous)
                                    .strokeBorder(Theme.hairline)
                            }
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Code \(code.filter { $0 != "-" }.map(String.init).joined(separator: " "))")
    }
}

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
            ScrollView {
                VStack(spacing: Metrics.space6) {
                    content
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, Metrics.space4)
                .padding(.bottom, Metrics.space8)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Link a TV")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                if phase != .done && phase != .denied {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
            }
        }
        .presentationDetents([.large])
        #if os(iOS)
        .sensoryFeedback(.success, trigger: phase == .done)
        #endif
        .task { if request != nil { await lookUp() } }
    }

    @ViewBuilder private var content: some View {
        if client == nil {
            MessageView(systemImage: "server.rack", title: "Not signed in to that server",
                        message: "Sign in on this phone to the server your TV is using, then scan the code again.")
        } else if phase == .done {
            LinkHero(systemImage: "checkmark", tint: Theme.success, title: "Your TV is signed in",
                     message: "It's watching as \(signIn?.name ?? "you") on \(server?.name ?? "this server").")
            PrimaryButton("Done") { dismiss() }
                .padding(.top, Metrics.space4)
        } else if phase == .denied {
            LinkHero(systemImage: "xmark", tint: Theme.ink3, title: "Sign-in declined",
                     message: "The TV wasn't signed in. It shows a new code if you want to try again.")
            PrimaryButton("Done") { dismiss() }
                .padding(.top, Metrics.space4)
        } else if looked != nil {
            LinkHero(systemImage: "tv", tint: Theme.apricot, title: "Sign in your TV?",
                     message: "Approve only a TV you're in front of.")
            // Someone could show you a code for their own device; matching the code on
            // your screen is what proves it's yours.
            VStack(spacing: Metrics.space3) {
                Text("Check your TV shows this code").font(.stFootnote).foregroundStyle(Theme.ink3)
                CodeTiles(DeviceCode.display(code))
            }
            .padding(.vertical, Metrics.space5)
            .frame(maxWidth: .infinity)
            .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
            VStack(spacing: 0) {
                detailRow("person.crop.circle", "Watches as", signIn?.name ?? "You")
                Divider().overlay(Theme.hairline).padding(.leading, 52)
                detailRow("server.rack", "Server", server?.name ?? "This server")
                Divider().overlay(Theme.hairline).padding(.leading, 52)
                detailRow("lock", "Access", "Watch only, no settings")
            }
            .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusLG, style: .continuous))
            errorLabel
            VStack(spacing: Metrics.space3) {
                PrimaryButton("Approve", isLoading: phase == .approving) { Task { await approve() } }
                    .disabled(phase == .approving)
                Button("Decline", role: .destructive) { Task { await deny() } }
                    .font(.stHeadline)
                    #if os(iOS)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    #endif
                    .disabled(phase == .approving)
            }
            .padding(.top, Metrics.space2)
        } else if request != nil {
            LinkHero(systemImage: "tv", tint: Theme.apricot, title: "Checking the code…", message: nil)
            if error == nil { ProgressView() }
            errorLabel
        } else {
            LinkHero(systemImage: "tv", tint: Theme.apricot, title: "Enter your TV's code",
                     message: "It will be signed in to \(server?.name ?? "this server") as \(signIn?.name ?? "you").")
            TextField("K7QF-2MXD", text: $typedCode)
                .font(.system(.title2, design: .monospaced).weight(.semibold))
                .multilineTextAlignment(.center)
                #if os(iOS)
                .textInputAutocapitalization(.characters)
                #endif
                .autocorrectionDisabled()
                .submitLabel(.continue)
                .onSubmit { Task { await lookUp() } }
                .modifier(FieldStyle())
            errorLabel
            PrimaryButton("Continue", isLoading: phase == .looking) { Task { await lookUp() } }
                .disabled(code.count < 8 || phase == .looking)
        }
    }

    private func detailRow(_ systemImage: String, _ label: String, _ value: String) -> some View {
        HStack(spacing: Metrics.space3) {
            Image(systemName: systemImage)
                .font(.stCallout)
                .foregroundStyle(Theme.ink3)
                .frame(width: 24)
            Text(label).font(.stCallout).foregroundStyle(Theme.ink2)
            Spacer(minLength: Metrics.space3)
            Text(value).font(.stCallout.weight(.medium)).foregroundStyle(Theme.ink).lineLimit(1)
        }
        .padding(.horizontal, Metrics.space4)
        .frame(minHeight: 48)
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
                VStack(spacing: Metrics.space6) {
                    if let error {
                        MessageView(systemImage: "appletv", title: "Couldn't sign in your TV", message: error, actionTitle: "Try Again") {
                            attempt += 1
                        }
                    } else {
                        LinkHero(systemImage: "tv", tint: Theme.apricot, title: "Finding your TV…",
                                 message: "Keep this phone on the same Wi-Fi as your Apple TV.")
                        ProgressView()
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, Metrics.space4)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .background(Theme.bg.ignoresSafeArea())
                .navigationTitle("Link a TV")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
            }
            .presentationDetents([.large])
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
