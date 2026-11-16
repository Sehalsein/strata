import SwiftUI
import StrataKit
import StrataDesign

/// An invitation's QR code or link was opened (`strata://invite`, or the invitation's web
/// page handing over to the app): shows which household and server it's for, then joins,
/// one question at a time. The invitation fixes the email, so it's never asked:
/// - Someone new picks a username (also their name, changeable in Edit Profile) and a
///   password.
/// - Someone whose email already has an account on the server enters its password, unless
///   this device is already signed in to it: then it just joins.
/// Asked first because any page could open such a link.
struct InviteView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let request: InviteRequest
    /// After joining (Add Profile closes itself).
    var onJoined: () -> Void = {}

    private enum Step: Hashable { case username, password, joinAs }

    @State private var invitation: Invitation?
    /// This device's sign-in for the invited email, when it has one.
    @State private var signedIn: SavedSignIn?
    @State private var loadError: String?
    @State private var step = Step.username
    @State private var username = ""
    @State private var password = ""
    @State private var joining = false
    @State private var error: String?
    @FocusState private var focused: Bool

    /// The server's rules for a new account.
    private static let minimumPassword = 8
    private static let usernamePattern = #/[a-zA-Z0-9_.\-]{2,64}/#

    private var address: String { ServerAddress.display(request.server) }
    private var hasAccount: Bool { invitation?.hasAccount == true }
    private var steps: [Step] {
        if signedIn != nil { return [.joinAs] }
        return hasAccount ? [.password] : [.username, .password]
    }
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
        case .joinAs: break
        }
        return nil
    }

    private var canContinue: Bool {
        switch step {
        case .username: trimmedUsername.wholeMatch(of: Self.usernamePattern) != nil
        case .password: hasAccount ? !password.isEmpty : password.count >= Self.minimumPassword
        case .joinAs: true
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
        case .joinAs: String(localized: "You're already signed in", bundle: .module)
        }
    }

    private var detail: String {
        switch step {
        case .username: String(localized: "What you'll sign in with, and your name in the household until you change it in your profile.", bundle: .module)
        case .password:
            hasAccount
                ? String(localized: "\(invitation?.email ?? "") already has an account here. Enter its password and the household is added to it.", bundle: .module)
                : String(localized: "At least \(Self.minimumPassword) characters.", bundle: .module)
        case .joinAs:
            String(localized: "This device is signed in as \(signedIn?.name ?? "you"). Joining adds the household to that account.", bundle: .module)
        }
    }

    private var buttonTitle: String {
        if step == .joinAs { return String(localized: "Join as \(signedIn?.name ?? "")", bundle: .module) }
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
        case .joinAs:
            EmptyView()
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
        if isLast { Task { await join() } } else { go(by: 1) }
    }

    private func load() async {
        do {
            let found = try await StrataClient(baseURL: request.server, cacheTTL: 0).invitation(id: request.invitationId)
            // An account already: this device may be signed in to it (only one this device
            // already has for that server, and only a full sign-in: a watch-only one can't
            // join households).
            if found.hasAccount == true {
                signedIn = await services.store.signIn(forEmail: found.email, serverAt: request.server)
            }
            invitation = found
            step = steps.first ?? .username
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
        let joined: Bool
        if let signedIn {
            joined = await services.store.acceptInvitation(request.invitationId, with: signedIn.id)
        } else {
            let account: ServerStore.InvitationAccount = hasAccount
                ? .existing(login: invitation.email, password: password)
                : .new(email: invitation.email.lowercased(), username: trimmedUsername, name: trimmedUsername, password: password)
            joined = await services.store.acceptInvitation(request.invitationId, url: request.server, as: account)
        }
        if joined {
            services.refreshClient()
            dismiss()
            onJoined()
        } else {
            error = services.store.lastError ?? String(localized: "Couldn't join.", bundle: .module)
        }
    }
}
