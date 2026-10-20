import SwiftUI
import StrataKit
import StrataDesign

/// "Who's watching?" after sign-in and when switching profiles.
struct ProfilePickerView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    var isSheet = false

    @State private var profiles: Loadable<[Profile]> = .loading
    @State private var pinFor: Profile?
    @State private var pin = ""
    @State private var pinError: String?

    #if os(tvOS)
    private let avatarSize: CGFloat = 160
    #else
    private let avatarSize: CGFloat = 96
    #endif

    var body: some View {
        VStack(spacing: Metrics.space8) {
            Text("Who's watching?").font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
            switch profiles {
            case .loading:
                ProgressView()
            case .failed(let message):
                MessageView(systemImage: "person.crop.circle.badge.exclamationmark", title: "Couldn't load profiles", message: message, actionTitle: "Try Again") {
                    Task { await load() }
                }
            case .loaded(let list):
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Metrics.space8) {
                        ForEach(list) { profile in
                            Button {
                                if profile.hasPin { pin = ""; pinError = nil; pinFor = profile } else { Task { await select(profile, pin: nil) } }
                            } label: {
                                VStack(spacing: Metrics.space3) {
                                    ProfileAvatar(name: profile.name, seed: "\(profile.id)", size: avatarSize)
                                    HStack(spacing: 4) {
                                        Text(profile.name)
                                        if profile.hasPin { Image(systemName: "lock.fill").font(.caption2) }
                                    }
                                    .font(.stCallout.weight(.medium))
                                    .foregroundStyle(Theme.ink2)
                                }
                            }
                            .buttonStyle(StrataCardStyle())
                        }
                    }
                    .padding(Metrics.space8)
                }
                .scrollClipDisabled()
            }
            if !isSheet {
                Button("Use a different server") {
                    Task { await services.store.signOut() }
                }
                .font(.stCallout)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.accentText)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
        .alert("Enter PIN for \(pinFor?.name ?? "")", isPresented: Binding(get: { pinFor != nil }, set: { if !$0 { pinFor = nil } })) {
            SecureField("PIN", text: $pin)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
            Button("Cancel", role: .cancel) { pinFor = nil }
            Button("Continue") {
                if let profile = pinFor { Task { await select(profile, pin: pin) } }
            }
        } message: {
            if let pinError { Text(pinError) }
        }
    }

    private func load() async {
        do {
            profiles = .loaded(try await services.store.profiles())
        } catch {
            profiles = .failed(StrataError.wrap(error).message)
        }
    }

    private func select(_ profile: Profile, pin: String?) async {
        do {
            try await services.store.selectProfile(id: profile.id, pin: pin)
            pinFor = nil
            services.refreshClient()
            if isSheet { dismiss() }
        } catch {
            pinError = StrataError.wrap(error).status == 403 ? "That PIN isn't right." : StrataError.wrap(error).message
            if pinFor == nil { pinFor = profile }
        }
    }
}
