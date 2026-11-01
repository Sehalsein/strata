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
    private let tile: CGFloat = 150
    private let preview: CGFloat = 180
    #else
    private let tile: CGFloat = 72
    private let preview: CGFloat = 104
    #endif

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var active: SavedSignIn? { services.store.active }
    private var changed: Bool { trimmed != active?.name || image != active?.image }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Metrics.space5) {
                    ProfileAvatar(name: trimmed.isEmpty ? "?" : trimmed, seed: active?.id ?? "", size: preview, imageURL: url(image))
                        .animation(.snappy, value: image)
                    TextField("Name", text: $name)
                        .textContentType(.name)
                        .multilineTextAlignment(.center)
                        .font(.stTitle2)
                        #if os(iOS)
                        .padding(.vertical, Metrics.space3)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
                        .frame(maxWidth: 320)
                        #else
                        .frame(maxWidth: 600)
                        #endif
                    if let message = error {
                        Text(message).font(.stFootnote).foregroundStyle(Theme.danger)
                    }
                    pictures
                }
                .padding(Metrics.space5)
            }
            .background(Theme.bg)
            .navigationTitle("Edit Profile")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }.disabled(trimmed.isEmpty || !changed)
                    }
                }
            }
        }
        .onAppear {
            name = active?.name ?? ""
            image = active?.image
        }
        .task { await load() }
    }

    @ViewBuilder private var pictures: some View {
        if let loadError {
            Text(loadError).font(.stFootnote).foregroundStyle(Theme.ink3)
        } else if groups.isEmpty {
            ProgressView().padding(.top, Metrics.space5)
        } else {
            VStack(alignment: .leading, spacing: Metrics.space5) {
                choice(nil, label: "Initial") {
                    ProfileAvatar(name: trimmed.isEmpty ? "?" : trimmed, seed: active?.id ?? "", size: tile)
                }
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        Text(group.title).eyebrowStyle(Theme.ink3)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: tile, maximum: tile + 24), spacing: Metrics.space3)], spacing: Metrics.space3) {
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
        .buttonStyle(.plain)
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
            loadError = "Couldn't load the pictures. \(StrataError.wrap(error).message)"
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
