#if os(iOS)
import SwiftUI
import StrataKit
import StrataDesign

/// "Forgot password?" on the sign-in screen (only where the server can send email): asks
/// for the account's email, and the server sends a link that opens the app at "Choose a new
/// password". The answer is the same whether or not an account uses the address.
struct ForgotPasswordView: View {
    @Environment(\.dismiss) private var dismiss
    let target: ServerTarget
    /// What was typed to sign in, when it was an email.
    var email = ""

    @State private var address = ""
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var trimmed: String { address.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var looksLikeEmail: Bool { trimmed.wholeMatch(of: #/[^\s@]+@[^\s@]+\.[^\s@]+/#) != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Metrics.space6) {
                    VStack(spacing: Metrics.space2) {
                        Image(systemName: sent ? "envelope.badge.fill" : "key.fill")
                            .font(.system(size: 48, weight: .regular))
                            .foregroundStyle(Theme.accentText)
                            .padding(.bottom, Metrics.space2)
                        Text(sent ? String(localized: "Check your email", bundle: .module) : String(localized: "Forgot your password?", bundle: .module))
                            .font(.stTitle2).multilineTextAlignment(.center)
                        Text(sent
                             ? String(localized: "If an account on \(target.info.serverName) uses \(trimmed), a link to choose a new password is on its way. Open it on this device and it comes back to Strata. It works for an hour; check your spam folder if it doesn't arrive.", bundle: .module)
                             : String(localized: "Enter your account's email and \(target.info.serverName) sends a link to choose a new password.", bundle: .module))
                            .font(.stCallout).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                    }
                    if sent {
                        PrimaryButton(String(localized: "Done", bundle: .module)) { dismiss() }
                    } else {
                        VStack(alignment: .leading, spacing: Metrics.space4) {
                            TextField(String(localized: "Email", bundle: .module), text: $address)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focused)
                                .submitLabel(.send)
                                .onSubmit { Task { await send() } }
                                .modifier(FieldStyle())
                            if let error {
                                Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                            }
                            PrimaryButton(String(localized: "Send Link", bundle: .module), isLoading: sending) {
                                Task { await send() }
                            }
                            .disabled(sending || !looksLikeEmail)
                            Text("No email on your account? Ask your household's admin to help you back in.", bundle: .module)
                                .font(.stFootnote).foregroundStyle(Theme.ink3)
                                .frame(maxWidth: .infinity)
                                .multilineTextAlignment(.center)
                        }
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .animation(.easeOut(duration: 0.2), value: sent)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                if !sent {
                    ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel", bundle: .module)) { dismiss() } }
                }
            }
            .onAppear {
                if address.isEmpty { address = email }
                focused = true
            }
        }
    }

    private func send() async {
        guard looksLikeEmail, !sending else { return }
        sending = true
        error = nil
        defer { sending = false }
        do {
            try await StrataClient(baseURL: target.url, cacheTTL: 0).requestPasswordReset(email: trimmed)
            focused = false
            sent = true
        } catch {
            let e = StrataError.wrap(error)
            self.error = e.status == 404
                ? String(localized: "\(target.info.serverName) can't send email. Ask your household's admin to help you back in.", bundle: .module)
                : e.message
        }
    }
}

/// A password-reset email's link was opened (`strata://reset-password`, which the web page
/// the email lands on hands over): a new password, typed twice, then sign in with it. The
/// server signs the account out everywhere else.
struct ResetPasswordView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let request: ResetPasswordRequest
    /// After signing in with the new password (Add Profile closes itself).
    var onSignedIn: () -> Void = {}

    @State private var password = ""
    @State private var confirm = ""
    @State private var saving = false
    @State private var done = false
    @State private var error: String?
    /// The server, to sign in to once it's changed.
    @State private var target: ServerTarget?
    @State private var signingIn = false
    @FocusState private var field: Field?
    private enum Field { case password, confirm }

    /// The server's minimum.
    private static let minimumLength = 8
    /// The address, never the name the server gives itself: any page can open this link,
    /// so where the new password goes must be plain.
    private var address: String { ServerAddress.display(request.server) }

    private var problem: String? {
        if password.isEmpty { return nil }
        if password.count < Self.minimumLength { return String(localized: "Use at least \(Self.minimumLength) characters.", bundle: .module) }
        if !confirm.isEmpty && confirm != password { return String(localized: "The passwords don't match.", bundle: .module) }
        return nil
    }

    private var canSave: Bool { password.count >= Self.minimumLength && confirm == password }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Metrics.space6) {
                    VStack(spacing: Metrics.space2) {
                        Image(systemName: done ? "checkmark.circle.fill" : "key.fill")
                            .font(.system(size: 48, weight: .regular))
                            .foregroundStyle(done ? Theme.success : Theme.accentText)
                            .padding(.bottom, Metrics.space2)
                        Text(done ? String(localized: "Password changed", bundle: .module) : String(localized: "Choose a new password", bundle: .module))
                            .font(.stTitle2).multilineTextAlignment(.center)
                        Text(done
                             ? String(localized: "Sign in with it. Your other devices were signed out and need it too.", bundle: .module)
                             : String(localized: "For your account on \(address). It signs you out on every other device.", bundle: .module))
                            .font(.stCallout).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                    }
                    if done {
                        PrimaryButton(String(localized: "Sign In", bundle: .module), isLoading: signingIn && target == nil) {
                            Task { await signIn() }
                        }
                        if let error {
                            Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: Metrics.space4) {
                            VStack(spacing: Metrics.space3) {
                                SecureField(String(localized: "New password", bundle: .module), text: $password)
                                    .textContentType(.newPassword)
                                    .focused($field, equals: .password)
                                    .submitLabel(.next)
                                    .onSubmit { field = .confirm }
                                    .modifier(FieldStyle())
                                SecureField(String(localized: "Confirm new password", bundle: .module), text: $confirm)
                                    .textContentType(.newPassword)
                                    .focused($field, equals: .confirm)
                                    .submitLabel(.done)
                                    .onSubmit { Task { await save() } }
                                    .modifier(FieldStyle())
                            }
                            if let message = error ?? problem {
                                Label(message, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                            }
                            PrimaryButton(String(localized: "Save New Password", bundle: .module), isLoading: saving) {
                                Task { await save() }
                            }
                            .disabled(saving || !canSave)
                        }
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .animation(.easeOut(duration: 0.2), value: done)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(done ? String(localized: "Close", bundle: .module) : String(localized: "Cancel", bundle: .module)) { dismiss() }
                }
            }
            .navigationDestination(isPresented: Binding(get: { signingIn && target != nil }, set: { signingIn = $0 })) {
                if let target {
                    SignInView(target: target) {
                        services.refreshClient()
                        dismiss()
                        onSignedIn()
                    }
                }
            }
            .onAppear { field = .password }
            .task { await loadServer() }
        }
    }

    private func loadServer() async {
        guard target == nil, let info = try? await StrataClient(baseURL: request.server, cacheTTL: 0).info() else { return }
        target = ServerTarget(url: request.server, info: info)
    }

    private func save() async {
        guard canSave, !saving else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await StrataClient(baseURL: request.server, cacheTTL: 0).resetPassword(token: request.token, newPassword: password)
            field = nil
            done = true
        } catch {
            let e = StrataError.wrap(error)
            self.error = e.code == "INVALID_TOKEN"
                ? String(localized: "This link has expired (links last an hour) or was already used. Ask for a new one with Forgot password? when signing in.", bundle: .module)
                : e.message
        }
    }

    /// Opens sign-in for the server (found when the screen opened, or now).
    private func signIn() async {
        error = nil
        signingIn = true
        if target == nil { await loadServer() }
        if target == nil {
            signingIn = false
            error = String(localized: "Couldn't reach \(address).", bundle: .module)
        }
    }
}
#endif
