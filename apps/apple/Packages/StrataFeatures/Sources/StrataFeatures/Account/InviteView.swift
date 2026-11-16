import SwiftUI
import StrataKit
import StrataDesign

/// An invitation's QR code or link was opened (`strata://invite`, or the invitation's web
/// page handing over to the app): shows which household and server it's for, then joins,
/// one question at a time. The invitation fixes the email, so it's never asked: someone new
/// picks a username (also their name, changeable in Edit Profile) and a password, which can
/// be skipped (they sign in with a code from their admin until they set one; the app
/// reminds them). Someone
/// whose email already has an account on the server only enters its password. Asked first
/// because any page could open such a link.
struct InviteView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let request: InviteRequest
    /// After joining (Add Profile closes itself).
    var onJoined: () -> Void = {}

    private enum Step: Hashable { case username, password }

    @State private var invitation: Invitation?
    @State private var loadError: String?
    @State private var step = Step.username
    @State private var username = ""
    @State private var password = ""
    @State private var joining = false
    /// The password step was skipped: one is set later.
    @State private var passwordLater = false
    @State private var error: String?
    @FocusState private var focused: Bool

    /// The server's rules for a new account.
    private static let minimumPassword = 8
    private static let usernamePattern = #/[a-zA-Z0-9_.\-]{2,64}/#

    private var address: String { ServerAddress.display(request.server) }
    private var hasAccount: Bool { invitation?.hasAccount == true }
    private var steps: [Step] { hasAccount ? [.password] : [.username, .password] }
    private var index: Int { steps.firstIndex(of: step) ?? 0 }
    private var isLast: Bool { index == steps.count - 1 }
    private var trimmedUsername: String { username.trimmingCharacters(in: .whitespaces) }

    /// Why Continue is off, once there's something to judge.
    private var problem: String? {
        switch step {
        case .username:
            if !trimmedUsername.isEmpty, trimmedUsername.wholeMatch(of: Self.usernamePattern) == nil {
                return String(localized: "Usernames are 2–64 letters, numbers, dots, dashes or underscores.", bundle: .module)
            }
        case .password:
            if !hasAccount, !password.isEmpty, password.count < Self.minimumPassword {
                return String(localized: "Use at least \(Self.minimumPassword) characters.", bundle: .module)
            }
        }
        return nil
    }

    private var canContinue: Bool {
        switch step {
        case .username: trimmedUsername.wholeMatch(of: Self.usernamePattern) != nil
        case .password: hasAccount ? !password.isEmpty : password.count >= Self.minimumPassword
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Metrics.space6) {
                    if let loadError {
                        intro
                        Label(loadError, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                            .multilineTextAlignment(.center)
                    } else if invitation == nil {
                        intro
                        ProgressView()
                    } else {
                        if index == 0 { intro }
                        stepView
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .animation(.easeOut(duration: 0.2), value: step)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if index > 0 {
                        Button(String(localized: "Back", bundle: .module)) { go(by: -1) }
                    } else {
                        Button(String(localized: "Cancel", bundle: .module)) { dismiss() }
                    }
                }
                if invitation != nil, steps.count > 1 {
                    ToolbarItem(placement: .principal) {
                        Text("Step \(index + 1) of \(steps.count)", bundle: .module).font(.stFootnote).foregroundStyle(Theme.ink3)
                    }
                }
                if step == .password && !hasAccount {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "Skip", bundle: .module)) { skip() }
                            .disabled(joining)
                    }
                }
            }
            .task { await load() }
        }
    }

    /// Which household, on which server, for whom.
    private var intro: some View {
        VStack(spacing: Metrics.space2) {
            Image(systemName: "envelope.open.fill")
                .font(.system(size: 48, weight: .regular))
                .foregroundStyle(Theme.accentText)
                .padding(.bottom, Metrics.space2)
            if let invitation {
                Text("Join \(invitation.household)", bundle: .module).font(.stTitle2).multilineTextAlignment(.center)
                Text("You're invited to watch on \(invitation.serverName) (\(address)) as \(invitation.email).", bundle: .module)
                    .font(.stCallout).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            } else {
                Text("You're invited", bundle: .module).font(.stTitle2).multilineTextAlignment(.center)
                Text("To a household on \(address).", bundle: .module)
                    .font(.stCallout).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            }
        }
    }

    private var stepView: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            VStack(alignment: .leading, spacing: Metrics.space1) {
                Text(title).font(.stHeadline).foregroundStyle(Theme.ink)
                Text(detail).font(.stFootnote).foregroundStyle(Theme.ink3)
            }
            field
            if let message = error ?? problem {
                Label(message, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
            }
            PrimaryButton(buttonTitle, isLoading: joining) { advance() }
                .disabled(joining || !canContinue)
        }
        .id(step)
        .transition(.opacity)
        .onAppear { focused = true }
    }

    private var title: String {
        switch step {
        case .username: String(localized: "Choose a username", bundle: .module)
        case .password:
            hasAccount ? String(localized: "Sign in to join", bundle: .module) : String(localized: "Choose a password", bundle: .module)
        }
    }

    private var detail: String {
        switch step {
        case .username: String(localized: "What you'll sign in with, and your name in the household until you change it in your profile.", bundle: .module)
        case .password:
            hasAccount
                ? String(localized: "\(invitation?.email ?? "") already has an account here. Enter its password and the household is added to it.", bundle: .module)
                : String(localized: "At least \(Self.minimumPassword) characters. Or skip it for now: you can sign in with a code from your admin, and set one later in Settings.", bundle: .module)
        }
    }

    private var buttonTitle: String {
        guard isLast else { return String(localized: "Continue", bundle: .module) }
        return hasAccount ? String(localized: "Sign In and Join", bundle: .module) : String(localized: "Create Account and Join", bundle: .module)
    }

    @ViewBuilder private var field: some View {
        switch step {
        case .username:
            TextField(String(localized: "Username", bundle: .module), text: $username)
                .textContentType(.username)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .focused($focused)
                .submitLabel(.next)
                .onSubmit { advance() }
                .modifier(FieldStyle())
        case .password:
            SecureField(String(localized: "Password", bundle: .module), text: $password)
                .textContentType(hasAccount ? .password : .newPassword)
                .focused($focused)
                .submitLabel(.join)
                .onSubmit { advance() }
                .modifier(FieldStyle())
        }
    }

    private func go(by offset: Int) {
        let next = index + offset
        guard steps.indices.contains(next) else { return }
        error = nil
        step = steps[next]
    }

    private func advance() {
        guard canContinue, !joining else { return }
        passwordLater = false
        if isLast { Task { await join() } } else { go(by: 1) }
    }

    /// Leaves the password for later.
    private func skip() {
        guard !joining, step == .password else { return }
        password = ""
        passwordLater = true
        Task { await join() }
    }

    private func load() async {
        do {
            let found = try await StrataClient(baseURL: request.server, cacheTTL: 0).invitation(id: request.invitationId)
            invitation = found
            step = found.hasAccount == true ? .password : .username
        } catch {
            let e = StrataError.wrap(error)
            loadError = e.status == 404
                ? String(localized: "This invitation has expired, was canceled or was already used. Ask for a new one.", bundle: .module)
                : e.message
        }
    }

    private func join() async {
        guard let invitation else { return }
        joining = true
        error = nil
        defer { joining = false }
        let account: ServerStore.InvitationAccount
        if hasAccount {
            account = .existing(login: invitation.email, password: password)
        } else {
            account = .new(email: invitation.email.lowercased(), username: trimmedUsername, name: trimmedUsername, password: passwordLater ? nil : password)
        }
        if await services.store.acceptInvitation(request.invitationId, url: request.server, as: account) {
            services.refreshClient()
            dismiss()
            onJoined()
        } else {
            error = services.store.lastError ?? String(localized: "Couldn't join.", bundle: .module)
        }
    }
}
