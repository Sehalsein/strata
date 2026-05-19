import SwiftUI
import StrataKit
import StrataDesign

public struct LoginView: View {
    @Environment(AppServices.self) private var services
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var hSizeClass
    private var isCompact: Bool { hSizeClass == .compact }
    #else
    private var isCompact: Bool { false }
    #endif

    @State private var serverURL: String = AuthStore.lastServerURL ?? "http://192.168.2.162:8096"
    @State private var username: String = ""
    @State private var password: String = ""
    @State private var motifIndex: Int = 0
    @State private var focusedField: Field?
    @FocusState private var focus: Field?

    /// Cycle through these motifs in the hero — picked for visual weight.
    private let heroMotifs: [MotifKey] = [.aurora, .megacity, .sunHorizon, .corridor, .vault, .archway]
    private let dateLine: String = {
        let f = DateFormatter()
        f.dateFormat = "MMM yyyy"
        return f.string(from: Date()).uppercased()
    }()

    private enum Field: Hashable { case server, username, password }

    public init() {}

    public var body: some View {
        GeometryReader { geo in
            ZStack {
                Strata.Tokens.bg.ignoresSafeArea()
                if isCompact || geo.size.width < 760 {
                    compactLayout
                } else {
                    regularLayout(width: geo.size.width)
                }
            }
        }
        #if os(iOS)
        .preferredColorScheme(.dark)
        #endif
    }

    // MARK: - Layouts

    private var compactLayout: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 0) {
                    hero
                        .frame(height: max(260, geo.size.height * 0.34))
                    form
                        .padding(.horizontal, 24)
                        .padding(.top, 20)
                        .padding(.bottom, 16)
                    footer
                        .padding(.horizontal, 24)
                        .padding(.bottom, 16)
                }
                .frame(minHeight: geo.size.height, alignment: .top)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    private func regularLayout(width: CGFloat) -> some View {
        HStack(spacing: 0) {
            hero
                .frame(width: width * 0.55)
            ScrollView {
                VStack(spacing: 0) {
                    form
                        .padding(.horizontal, 56)
                        .padding(.top, 64)
                    Spacer(minLength: 48)
                    footer
                        .padding(.horizontal, 56)
                        .padding(.bottom, 32)
                }
                .frame(minHeight: 600)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Hero

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            // Slow-cycling palette wash behind the motif so the room "breathes".
            let key = "login-\(motifIndex)"
            let palette = StrataTheme.palette(for: key)
            AmbientBackdrop(key: key, intensity: 1.0)
                .animation(.easeInOut(duration: 1.4), value: motifIndex)

            // The motif itself — sits behind a heavy ink scrim so the form text
            // is always legible no matter which motif rotated in.
            Motif(key: heroMotifs[motifIndex % heroMotifs.count], palette: palette)
                .opacity(0.55)
                .blendMode(.plusLighter)
                .transition(.opacity)
                .id(motifIndex)
                .animation(.easeInOut(duration: 1.4), value: motifIndex)
                .overlay(
                    LinearGradient(
                        colors: [.black.opacity(0.05),
                                 Strata.Tokens.bg.opacity(0.45),
                                 Strata.Tokens.bg],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .clipped()

            // Editorial overline + wordmark + tagline.
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Text("CINEMATHÈQUE")
                        .font(.mono(10, weight: .semibold))
                        .tracking(2.5)
                        .foregroundStyle(Strata.Tokens.paperDim)
                    Rectangle().fill(Strata.Tokens.paperHair).frame(width: 32, height: 1)
                    Text("№ \(StrataTheme.opus(for: "login"))")
                        .font(.mono(10))
                        .tracking(1.6)
                        .foregroundStyle(Strata.Tokens.paperDim)
                    Spacer(minLength: 0)
                    Text(dateLine)
                        .font(.mono(10))
                        .tracking(1.6)
                        .foregroundStyle(Strata.Tokens.paperDim)
                }

                Text("STRATA")
                    .font(.fraunces(isCompact ? 72 : 96, opticalSize: 144, soft: 50, wonk: 1))
                    .foregroundStyle(Strata.Tokens.paper)
                    .tracking(-2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("Tonight's programme,")
                        .font(.fraunces(17, opticalSize: 30, soft: 100))
                        .italic()
                        .foregroundStyle(Strata.Tokens.paperDim)
                    Text("served warm.")
                        .font(.fraunces(17, opticalSize: 30, soft: 100))
                        .italic()
                        .foregroundStyle(Strata.Tokens.accent2)
                }
            }
            .padding(.horizontal, isCompact ? 24 : 48)
            .padding(.bottom, isCompact ? 24 : 56)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .task { await cycleMotifs() }
    }

    // MARK: - Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("ACT I").strataSpec()
                    Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
                }
                Text("Sign in")
                    .font(.fraunces(30, opticalSize: 96, soft: 40))
                    .foregroundStyle(Strata.Tokens.paper)
                Text("Point Strata at your Jellyfin server and step inside.")
                    .font(.plex(13))
                    .foregroundStyle(Strata.Tokens.paperDim)
            }

            VStack(alignment: .leading, spacing: 14) {
                field(.server, label: "Server",
                      placeholder: "http://192.168.2.162:8096",
                      systemImage: "server.rack",
                      text: $serverURL)
                field(.username, label: "Username",
                      placeholder: "you@strata",
                      systemImage: "person.fill",
                      text: $username)
                field(.password, label: "Password",
                      placeholder: "••••••",
                      systemImage: "lock.fill",
                      text: $password,
                      isSecure: true)
            }

            if let err = services.auth.lastError {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Strata.Tokens.danger)
                        .padding(.top, 1)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("SIGN-IN FAILED").strataSpec()
                            .foregroundStyle(Strata.Tokens.danger)
                        Text(err)
                            .font(.plex(12))
                            .foregroundStyle(Strata.Tokens.paper.opacity(0.85))
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Strata.Tokens.danger.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: Strata.cornerRadius)
                        .stroke(Strata.Tokens.danger.opacity(0.35), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius))
                .transition(.opacity)
            }

            signInButton

            HStack(spacing: 6) {
                Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
                Text("HOSTED ON YOUR HARDWARE")
                    .font(.mono(9))
                    .tracking(1.8)
                    .foregroundStyle(Strata.Tokens.paperFaint)
                Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: 460, alignment: .leading)
        .animation(.easeInOut(duration: 0.2), value: services.auth.lastError)
    }

    private var signInButton: some View {
        Button(action: submit) {
            HStack(spacing: 12) {
                Text(services.auth.isAuthenticating ? "SIGNING IN" : "SIGN IN")
                    .font(.mono(12, weight: .semibold))
                    .tracking(2.5)
                Spacer()
                if services.auth.isAuthenticating {
                    ProgressView()
                        .controlSize(.small)
                        .tint(Strata.Tokens.bg)
                } else {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .semibold))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .foregroundStyle(canSubmit ? Strata.Tokens.bg : Strata.Tokens.bg.opacity(0.55))
            .background(canSubmit ? Strata.Tokens.paper : Strata.Tokens.paper.opacity(0.35))
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit || services.auth.isAuthenticating)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Text("STRATA · BUILD 0.1.0").font(.mono(9)).tracking(1.6)
                .foregroundStyle(Strata.Tokens.paperFaint)
            Spacer()
            Text("VOL. \(StrataTheme.volume(for: "login"))").font(.mono(9)).tracking(1.6)
                .foregroundStyle(Strata.Tokens.paperFaint)
        }
        .frame(maxWidth: 460)
    }

    // MARK: - Field

    @ViewBuilder
    private func field(_ id: Field,
                       label: String,
                       placeholder: String,
                       systemImage: String,
                       text: Binding<String>,
                       isSecure: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).strataSpec()
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(focus == id ? Strata.Tokens.accent2 : Strata.Tokens.paperDim)
                    .frame(width: 18)
                Group {
                    if isSecure {
                        SecureField(placeholder, text: text)
                    } else {
                        TextField(placeholder, text: text)
                            #if os(iOS)
                            .keyboardType(label == "Server" ? .URL : .default)
                            .textInputAutocapitalization(.never)
                            .textContentType(label == "Username" ? .username : nil)
                            #endif
                            .autocorrectionDisabled(true)
                    }
                }
                .focused($focus, equals: id)
                .font(label == "Server" ? .mono(13) : .plex(14))
                .foregroundStyle(Strata.Tokens.paper)
                .tint(Strata.Tokens.accent)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .background(focus == id ? Strata.Tokens.paper.opacity(0.06) : Strata.Tokens.paper.opacity(0.03))
            .overlay(
                RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous)
                    .stroke(focus == id ? Strata.Tokens.accent2.opacity(0.7) : Strata.Tokens.paperHair,
                            lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Strata.cornerRadius, style: .continuous))
            .animation(.easeOut(duration: 0.15), value: focus)
        }
    }

    // MARK: - Behavior

    private var canSubmit: Bool {
        guard let url = URL(string: serverURL), url.scheme != nil else { return false }
        return !username.isEmpty && !password.isEmpty
    }

    private func submit() {
        guard let url = URL(string: serverURL) else { return }
        focus = nil
        Task {
            await services.auth.signIn(serverURL: url, username: username, password: password)
            services.refreshSessionDependentServices()
        }
    }

    /// Slowly rotate through the hero motifs to give the screen a sense of
    /// scheduled programming rather than a static product shot.
    private func cycleMotifs() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 7_000_000_000)
            if Task.isCancelled { return }
            await MainActor.run {
                withAnimation(.easeInOut(duration: 1.4)) {
                    motifIndex = (motifIndex + 1) % heroMotifs.count
                }
            }
        }
    }
}
