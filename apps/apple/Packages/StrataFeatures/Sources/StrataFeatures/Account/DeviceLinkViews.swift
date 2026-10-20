import SwiftUI
import StrataKit
import StrataDesign

/// A server picked on the Connect screen, ready to sign in to.
struct ServerTarget: Identifiable, Hashable {
    let url: URL
    let info: ServerInfo
    var id: String { url.absoluteString }
}

#if os(tvOS)
/// TV sign-in: a QR code a signed-in phone scans to approve this TV, with the
/// code spelled out for typing in instead. Password sign-in stays one click away.
struct TVCodeSignInView: View {
    @Environment(AppServices.self) private var services
    let target: ServerTarget
    let onSignedIn: () -> Void

    @State private var link: DeviceLink?
    @State private var error: String?
    /// Bumped to fetch a fresh code (the old one expired).
    @State private var attempt = 0
    @State private var usePassword = false

    var body: some View {
        HStack(alignment: .center, spacing: Metrics.space20) {
            VStack(alignment: .leading, spacing: Metrics.space10) {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text("Sign in to \(target.info.serverName)").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                    Text("Scan the code with your phone's camera, then tap Approve in Strata.")
                        .font(.stBody).foregroundStyle(Theme.ink2)
                }
                if let link {
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        Text("Or enter this code in Settings › Sign In a TV")
                            .font(.stCallout).foregroundStyle(Theme.ink3)
                        Text(link.displayCode)
                            .font(.system(size: 64, weight: .semibold, design: .monospaced))
                            .tracking(4)
                            .foregroundStyle(Theme.ink)
                            .accessibilityLabel("Code \(link.displayCode.map(String.init).joined(separator: " "))")
                    }
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").font(.stCallout).foregroundStyle(Theme.danger)
                }
                Button("Use Password Instead") { usePassword = true }
            }
            .frame(maxWidth: 820, alignment: .leading)

            Group {
                if let link, let url = link.approvalURL(serverID: target.info.id) {
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
            SignInView(address: target.url.absoluteString, serverName: target.info.serverName, onSignedIn: onSignedIn)
        }
        .task(id: attempt) { await run() }
    }

    /// Gets a code, then polls until a phone approves it. An expired code is
    /// replaced with a new one; the loop ends when the view goes away.
    private func run() async {
        let client = StrataClient(baseURL: target.url, cacheTTL: 0)
        do {
            let fresh = try await client.startDeviceLink()
            link = fresh
            error = nil
            while !Task.isCancelled {
                try await Task.sleep(for: .milliseconds(max(1000, fresh.pollIntervalMs)))
                if Date() >= fresh.expiresDate { attempt += 1; return }
                let poll = try? await client.pollDeviceLink(fresh.pollToken)
                switch poll?.status {
                case .approved:
                    guard let token = poll?.token else { return }
                    if await services.store.signIn(token: token, url: target.url, info: target.info) {
                        onSignedIn()
                    } else {
                        error = services.store.lastError
                    }
                    return
                case .expired:
                    attempt += 1
                    return
                default:
                    continue // pending, or a dropped poll: try again next tick
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
#endif

/// Phone side: confirms and approves a TV's sign-in code, from a scanned QR code
/// (`request` set) or typed in from Settings (`request` nil).
struct ApproveDeviceView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    var request: LinkRequest?

    @State private var typedCode = ""
    @State private var pending: PendingDeviceLink?
    @State private var phase: Phase = .idle
    @State private var error: String?

    enum Phase { case idle, looking, approving, done }

    private var serverID: String? { request?.serverID ?? services.store.activeID }
    private var server: SavedServer? { services.store.servers.first { $0.id == serverID } }
    private var client: StrataClient? { serverID.flatMap { services.store.client(forServer: $0) } }
    private var code: String { DeviceLink.normalize(request?.code ?? typedCode) }

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
            .navigationTitle("Sign In a TV")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(phase == .done ? "Done" : "Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task { if request != nil { await lookUp() } }
    }

    @ViewBuilder private var content: some View {
        if client == nil {
            MessageView(systemImage: "server.rack", title: "Not signed in to that server",
                        message: "Sign in to the server your TV is using on this phone first, then scan the code again.")
        } else if phase == .done {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(Theme.success)
                Text("Your TV is signed in").font(.stTitle2).foregroundStyle(Theme.ink)
                Text("Pick a profile on the TV to start watching.").font(.stCallout).foregroundStyle(Theme.ink2)
            }
        } else if let pending {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                Text("Approve this sign-in?").font(.stTitle2).foregroundStyle(Theme.ink)
                Text("“\(pending.deviceName)” will be signed in to \(server?.name ?? "this server") as \(server?.username ?? "you").")
                    .font(.stCallout).foregroundStyle(Theme.ink2)
            }
            // Someone could show you a code for their own device; matching the code on
            // your screen is what proves it's yours.
            VStack(alignment: .leading, spacing: Metrics.space2) {
                Text("Check that your TV shows this code").font(.stFootnote).foregroundStyle(Theme.ink3)
                Text(DeviceLink(code: code, pollToken: "", expiresAt: 0, pollIntervalMs: 0).displayCode)
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
        } else {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                Text("Enter the code shown on your TV.").font(.stCallout).foregroundStyle(Theme.ink2)
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

    private func lookUp() async {
        guard let client, !code.isEmpty else { return }
        phase = .looking
        error = nil
        defer { if phase == .looking { phase = .idle } }
        do {
            pending = try await client.pendingDeviceLink(code: code)
        } catch {
            self.error = StrataError.wrap(error).message
        }
    }

    private func approve() async {
        guard let client else { return }
        phase = .approving
        error = nil
        do {
            try await client.approveDeviceLink(code: code)
            phase = .done
        } catch {
            self.error = StrataError.wrap(error).message
            phase = .idle
        }
    }
}
