import SwiftUI
import StrataKit
import StrataDesign
import os

// MARK: - Metadata row

public struct MetadataRow: View {
    public let item: BaseItem
    public let extraChips: [String]
    public init(item: BaseItem, extraChips: [String] = []) {
        self.item = item
        self.extraChips = extraChips
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if let year = item.productionYear { Chip(String(year)) }
                if let rating = item.officialRating { Chip(rating) }
                if let minutes = item.runtimeSeconds.map({ Int($0 / 60) }), minutes > 0 {
                    Chip("\(minutes) MIN")
                }
                if let community = item.communityRating, community > 0 {
                    Chip(String(format: "★ %.1f", community), variant: .ghost)
                }
                ForEach(extraChips, id: \.self) { c in
                    Chip(c, variant: .outline)
                }
            }
        }
    }
}

// MARK: - Watchlist button

public struct WatchlistButton: View {
    public let itemId: String
    @Binding public var isFavorite: Bool
    public let client: JellyfinClient?

    public init(itemId: String, isFavorite: Binding<Bool>, client: JellyfinClient?) {
        self.itemId = itemId
        self._isFavorite = isFavorite
        self.client = client
    }

    public var body: some View {
        SecondaryButton(
            isFavorite ? "Watchlisted" : "Watchlist",
            systemImage: isFavorite ? "bookmark.fill" : "bookmark"
        ) {
            toggle()
        }
    }

    private func toggle() {
        guard let client else { return }
        let newValue = !isFavorite
        isFavorite = newValue
        Task {
            do {
                try await client.setFavorite(itemId: itemId, isFavorite: newValue)
            } catch {
                Log.detail.error("WatchlistButton toggle failed: \(String(describing: error), privacy: .public)")
                await MainActor.run { isFavorite = !newValue }
            }
        }
    }
}

// MARK: - Cast shelf

public struct CastShelf: View {
    public let people: [Person]
    public let images: ImageURLBuilder?

    public init(people: [Person], images: ImageURLBuilder?) {
        self.people = people
        self.images = images
    }

    public var body: some View {
        let actors = people.filter { ($0.type ?? "").caseInsensitiveCompare("Actor") == .orderedSame }
        let cast = actors.isEmpty ? people : actors
        VStack(alignment: .leading, spacing: shelfHeaderSpacing) {
            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Text("CAST")
                    #if os(tvOS)
                    .font(.mono(18, weight: .semibold)).tracking(3.2)
                    #else
                    .font(.mono(11, weight: .semibold)).tracking(2.5)
                    #endif
                    .foregroundStyle(Strata.Tokens.paper)
                Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: itemSpacing) {
                    ForEach(cast.prefix(20)) { person in
                        #if os(tvOS)
                        Button(action: {}) {
                            CastChip(person: person, images: images)
                                .frame(width: chipWidth)
                        }
                        .buttonStyle(StrataPlainCardButtonStyle())
                        #else
                        CastChip(person: person, images: images)
                            .frame(width: chipWidth)
                        #endif
                    }
                }
                #if os(tvOS)
                .padding(.horizontal, 12)
                .padding(.vertical, 20)
                #else
                .padding(.vertical, 4)
                #endif
            }
        }
    }

    private var shelfHeaderSpacing: CGFloat {
        #if os(tvOS)
        20
        #else
        12
        #endif
    }
    private var itemSpacing: CGFloat {
        #if os(tvOS)
        24
        #else
        14
        #endif
    }
    private var chipWidth: CGFloat {
        #if os(tvOS)
        160
        #else
        110
        #endif
    }
}

private struct CastChip: View {
    let person: Person
    let images: ImageURLBuilder?
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        VStack(alignment: .center, spacing: 10) {
            ZStack {
                Circle().fill(Strata.Tokens.paper.opacity(0.06))
                if let url = images?.primary(itemId: person.id, maxWidth: 240) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let img):
                            img.resizable().scaledToFill()
                        default:
                            Text(initials)
                                .font(.fraunces(22, opticalSize: 36, soft: 60))
                                .foregroundStyle(Strata.Tokens.paper.opacity(0.6))
                        }
                    }
                } else {
                    Text(initials)
                        .font(.fraunces(22, opticalSize: 36, soft: 60))
                        .foregroundStyle(Strata.Tokens.paper.opacity(0.6))
                }
            }
            .frame(width: avatarSize, height: avatarSize)
            .clipShape(Circle())
            .overlay(
                Circle().stroke(
                    isFocused ? Strata.Tokens.paper : Strata.Tokens.paperHair,
                    lineWidth: isFocused ? 2 : 1
                )
            )
            .scaleEffect(isFocused ? 1.06 : 1.0)
            .animation(.easeOut(duration: 0.22), value: isFocused)
            VStack(alignment: .center, spacing: 2) {
                Text(person.name ?? "—")
                    .font(.plex(13, weight: .semibold))
                    .foregroundStyle(Strata.Tokens.paper)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                if let role = person.role, !role.isEmpty {
                    Text(role)
                        .font(.plex(11))
                        .foregroundStyle(Strata.Tokens.paperDim)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var avatarSize: CGFloat {
        #if os(tvOS)
        140
        #else
        96
        #endif
    }

    private var initials: String {
        let parts = (person.name ?? "").split(separator: " ").prefix(2)
        let chars = parts.compactMap { $0.first }
        return chars.isEmpty ? "·" : String(chars).uppercased()
    }
}

// MARK: - Similar shelf

public struct SimilarShelf: View {
    public let items: [BaseItem]
    public let images: ImageURLBuilder?
    public let onSelect: (BaseItem) -> Void

    public init(items: [BaseItem], images: ImageURLBuilder?, onSelect: @escaping (BaseItem) -> Void) {
        self.items = items
        self.images = images
        self.onSelect = onSelect
    }

    public var body: some View {
        Shelf(title: "In the Same Spirit", items: items, images: images, onSelect: onSelect)
    }
}

// MARK: - Movie info panel

public struct MovieInfoSection: View {
    public let item: BaseItem
    public init(item: BaseItem) { self.item = item }

    public var body: some View {
        let rows = buildRows()
        if rows.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 14) {
                    Text("INFORMATION")
                        #if os(tvOS)
                        .font(.mono(18, weight: .semibold)).tracking(3.2)
                        #else
                        .font(.mono(11, weight: .semibold)).tracking(2.5)
                        #endif
                        .foregroundStyle(Strata.Tokens.paper)
                    Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
                }
                GlassPanel {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.offset) { idx, row in
                            HStack(alignment: .firstTextBaseline, spacing: 16) {
                                Text(row.label.uppercased())
                                    .font(.mono(10))
                                    .tracking(1.6)
                                    .foregroundStyle(Strata.Tokens.paperDim)
                                    .frame(width: labelWidth, alignment: .leading)
                                Text(row.value)
                                    .font(.plex(13))
                                    .foregroundStyle(Strata.Tokens.paper)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.vertical, 8)
                            if idx < rows.count - 1 {
                                Rectangle().fill(Strata.Tokens.paperHair).frame(height: 1)
                            }
                        }
                    }
                }
            }
        }
    }

    private var labelWidth: CGFloat {
        #if os(tvOS)
        180
        #else
        110
        #endif
    }

    private struct InfoRow { let label: String; let value: String }

    private func buildRows() -> [InfoRow] {
        var rows: [InfoRow] = []
        if let original = item.originalTitle, original != item.name, !original.isEmpty {
            rows.append(.init(label: "Original Title", value: original))
        }
        if let date = formattedPremiere(item.premiereDate) {
            rows.append(.init(label: "Released", value: date))
        }
        let streams = item.mediaSources?.first?.mediaStreams ?? item.mediaStreams ?? []
        if let videoLabel = describeVideo(streams) {
            rows.append(.init(label: "Video", value: videoLabel))
        }
        let audio = streams.filter { $0.type == .audio }
        if !audio.isEmpty {
            rows.append(.init(label: "Audio", value: joinedStreams(audio)))
        }
        let subs = streams.filter { $0.type == .subtitle }
        if !subs.isEmpty {
            rows.append(.init(label: "Subtitles", value: joinedStreams(subs)))
        }
        if let container = item.mediaSources?.first?.container, !container.isEmpty {
            rows.append(.init(label: "Container", value: container.uppercased()))
        }
        return rows
    }

    private func formattedPremiere(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = iso.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        guard let date else { return String(raw.prefix(10)) }
        let df = DateFormatter()
        df.dateStyle = .medium
        df.timeStyle = .none
        return df.string(from: date)
    }

    private func describeVideo(_ streams: [MediaStream]) -> String? {
        guard let v = streams.first(where: { $0.type == .video }) else { return nil }
        var parts: [String] = []
        if let h = v.height {
            parts.append(resolutionLabel(height: h))
        }
        if let codec = v.codec, !codec.isEmpty { parts.append(codec.uppercased()) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func resolutionLabel(height: Int) -> String {
        switch height {
        case ...479: return "SD"
        case ...719: return "480p"
        case ...1079: return "720p"
        case ...1439: return "1080p"
        case ...2159: return "1440p"
        default: return "4K"
        }
    }

    private func joinedStreams(_ streams: [MediaStream]) -> String {
        streams.prefix(3).map { stream -> String in
            stream.displayTitle
                ?? stream.title
                ?? stream.language?.uppercased()
                ?? stream.codec?.uppercased()
                ?? "Track \(stream.index)"
        }.joined(separator: " · ")
    }
}
