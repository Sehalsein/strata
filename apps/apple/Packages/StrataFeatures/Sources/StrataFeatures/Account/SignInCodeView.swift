import SwiftUI
import StrataKit
import StrataDesign

/// A member's sign-in QR code was scanned (it opens `strata://sign-in`): shows which server
/// it's for and signs in as that member once confirmed. Asked first because any page could
/// open such a link, and signing this device in to a stranger's server must take a tap.
struct SignInCodeView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let request: SignInCodeRequest

    @State private var serverName: String?
    @State private var signingIn = false
    @State private var error: String?

    private var address: String { ServerAddress.display(request.server) }

    var body: some View {
        NavigationStack {
            VStack(spacing: Metrics.space6) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 56, weight: .regular))
                    .foregroundStyle(Theme.accentText)
                VStack(spacing: Metrics.space2) {
                    Text("Sign in to \(serverName ?? "Strata")?").font(.stTitle2).multilineTextAlignment(.center)
                    Text("This code signs this device in to \(address) as the person it was made for, able to watch.")
                        .font(.stCallout).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                        .multilineTextAlignment(.center)
                }
                Button {
                    Task { await signIn() }
                } label: {
                    HStack {
                        if signingIn { ProgressView() }
                        Text("Sign In")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(signingIn)
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task {
                serverName = try? await StrataClient(baseURL: request.server, cacheTTL: 0).info().serverName
            }
        }
        .presentationDetents([.medium])
    }

    private func signIn() async {
        signingIn = true
        error = nil
        defer { signingIn = false }
        if await services.store.signIn(code: request.code, url: request.server) {
            services.refreshClient()
            dismiss()
        } else {
            error = services.store.lastError ?? "Couldn't sign in."
        }
    }
}
