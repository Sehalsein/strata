import SwiftUI
import StrataDesign
import StrataKit

/// The active profile's name and picture. Pictures are the server's own set (original
/// characters, `GET /api/avatars`), shown in its groups.
struct EditProfileView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var image: String?
    @State private var groups: [AvatarGroup] = []
    @State private var loadError: String?
    @State private var saving = false
    @State private var error: String?

    #if os(tvOS)
    private let tile: CGFloat = 140
    private let preview: CGFloat = 240
    private let tileGap: CGFloat = 48
    #else
    private let tile: CGFloat = 72
    private let preview: CGFloat = 104
    private let tileGap: CGFloat = Metrics.space3
    #endif

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var active: SavedSignIn? { services.store.active }
    private var changed: Bool { trimmed != active?.name || image != active?.image }

    var body: some View {
        content
            .onAppear {
                name = active?.name ?? ""
                image = active?.image
            }
            .task { await load() }
    }

    #if os(tvOS)
    /// Full screen on the TV, like Settings: the profile on the left with its name and
    /// actions, the pictures to choose from on the right. Menu cancels.
    private var content: some View {
        HStack(alignment: .top, spacing: 96) {
            VStack(spacing: Metrics.space6) {
                Text("Edit Profile", bundle: .module)
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(.secondary)
                ProfileAvatar(name: trimmed.isEmpty ? "?" : trimmed, seed: active?.id ?? "", size: preview, imageURL: url(image))
                    .animation(.snappy, value: image)
                TextField(String(localized: "Name", bundle: .module), text: $name)
                    .textContentType(.name)
                    .multilineTextAlignment(.center)
                if let message = error {
                    Text(message).font(.stFootnote).foregroundStyle(Theme.danger).multilineTextAlignment(.center)
                }
                HStack(spacing: Metrics.space4) {
                    Button(String(localized: "Cancel", bundle: .module)) { dismiss() }
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView() } else { Text("Save", bundle: .module) }
                    }
                    .disabled(trimmed.isEmpty || !changed || saving)
                }
                .padding(.top, Metrics.space4)
            }
            .frame(width: 520)
            .padding(.top, 120)
            .focusSection()

            ScrollView {
                pictures.padding(.vertical, 120)
            }
            .scrollClipDisabled()
            .focusSection()
        }
        .padding(.horizontal, 80)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
    }
    #else
    private var content: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Metrics.space5) {
                    ProfileAvatar(name: trimmed.isEmpty ? "?" : trimmed, seed: active?.id ?? "", size: preview, imageURL: url(image))
                        .animation(.snappy, value: image)
                    TextField(String(localized: "Name", bundle: .module), text: $name)
                        .textContentType(.name)
                        .multilineTextAlignment(.center)
                        .font(.stTitle2)
                        .padding(.vertical, Metrics.space3)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
                        .frame(maxWidth: 320)
                    if let message = error {
                        Text(message).font(.stFootnote).foregroundStyle(Theme.danger)
                    }
                    pictures
                }
                .padding(Metrics.space5)
            }
            .background(Theme.bg)
            .navigationTitle(Text("Edit Profile", bundle: .module))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel", bundle: .module)) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button(String(localized: "Save", bundle: .module)) { Task { await save() } }.disabled(trimmed.isEmpty || !changed)
                    }
                }
            }
        }
    }
    #endif

    @ViewBuilder private var pictures: some View {
        if let loadError {
            Text(loadError).font(.stFootnote).foregroundStyle(Theme.ink3)
        } else if groups.isEmpty {
            ProgressView().padding(.top, Metrics.space5)
        } else {
            VStack(alignment: .leading, spacing: Metrics.isTV ? Metrics.space8 : Metrics.space5) {
                choice(nil, label: String(localized: "Initial", bundle: .module)) {
                    ProfileAvatar(name: trimmed.isEmpty ? "?" : trimmed, seed: active?.id ?? "", size: tile)
                }
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        Text(group.title).eyebrowStyle(Theme.ink3)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: tile, maximum: tile + 24), spacing: tileGap)], spacing: tileGap) {
                            ForEach(group.avatars) { avatar in
                                choice(avatar.url, label: avatar.name) {
                                    ProfileAvatar(name: avatar.name, seed: avatar.id, size: tile, imageURL: url(avatar.url))
                                }
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func choice(_ path: String?, label: String, @ViewBuilder avatar: () -> some View) -> some View {
        Button {
            image = path
        } label: {
            avatar()
                .overlay {
                    if image == path { Circle().stroke(Theme.accentText, lineWidth: 3).padding(-5) }
                }
                .padding(5)
        }
        #if os(tvOS)
        // Focus lifts the picture itself, as on the system's profile pickers.
        .buttonStyle(AvatarChoiceStyle())
        #else
        .buttonStyle(.plain)
        #endif
        .accessibilityLabel(label)
        .accessibilityAddTraits(image == path ? .isSelected : [])
    }

    private func url(_ path: String?) -> URL? {
        guard let path else { return nil }
        return services.store.client?.absoluteURL(path)
    }

    private func load() async {
        guard let client = services.store.client else { return }
        do {
            groups = try await client.avatars()
        } catch {
            loadError = String(localized: "Couldn't load the pictures. \(StrataError.wrap(error).message)", bundle: .module)
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await services.store.updateProfile(name: trimmed, image: image)
            dismiss()
        } catch {
            self.error = StrataError.wrap(error).message
        }
    }
}

#if os(tvOS)
/// A picture that grows and casts a shadow when focused, with its name underneath.
private struct AvatarChoiceStyle: ButtonStyle {
    @Environment(\.isFocused) private var focused

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 1.05 : focused ? 1.15 : 1)
            .shadow(color: .black.opacity(focused ? 0.5 : 0), radius: 20, y: 12)
            .animation(.snappy(duration: 0.2), value: focused)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}
#endif
