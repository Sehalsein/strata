import SwiftUI
import StrataKit
import StrataDesign

/// "Choose a source": library files first, then releases discovery finds on TorBox.
struct SourcePickerSheet: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let target: PlaybackTarget
    let title: String
    let onChoose: (Candidate) -> Void

    @State private var sources: Loadable<[Candidate]> = .loading
    @State private var filter: Filter = .all

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", uhd = "4K", hd = "1080p", sd = "720p"
        var id: String { rawValue }
        func matches(_ c: Candidate) -> Bool {
            switch self {
            case .all: true
            case .uhd: (c.resolution ?? 0) >= 2160
            case .hd: c.resolution == 1080
            case .sd: (c.resolution ?? 0) > 0 && (c.resolution ?? 0) <= 720
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    Picker("Quality", selection: $filter) {
                        ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    switch sources {
                    case .loading:
                        HStack(spacing: Metrics.space3) {
                            ProgressView()
                            Text("Looking in your library and on TorBox…").font(.stCallout).foregroundStyle(Theme.ink2)
                        }
                        .padding(.vertical, Metrics.space8)
                    case .failed(let message):
                        MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't find sources", message: message)
                    case .loaded(let all):
                        let shown = all.filter(filter.matches)
                        if shown.isEmpty {
                            MessageView(systemImage: "rectangle.stack.badge.minus", title: "No sources", message: filter == .all ? "Nothing in your library or on TorBox for this title." : "Try another quality.")
                        } else {
                            VStack(spacing: 0) {
                                ForEach(shown) { candidate in
                                    Button {
                                        dismiss()
                                        onChoose(candidate)
                                    } label: {
                                        SourceRow(candidate: candidate)
                                    }
                                    .buttonStyle(.plain)
                                    if candidate.id != shown.last?.id { Divider().overlay(Theme.hairline) }
                                }
                            }
                            .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
                        }
                    }
                }
                .padding(Metrics.space5)
            }
            .navigationTitle("Choose a Source")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .task { sources = await services.load { try await $0.sources(target, discover: true) } }
    }
}

struct SourceRow: View {
    let candidate: Candidate

    var body: some View {
        HStack(alignment: .top, spacing: Metrics.space3) {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                Text(candidate.displayName).font(.stHeadline).foregroundStyle(Theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                HStack(spacing: Metrics.space2) {
                    ForEach(candidate.specLabels.filter { $0 != candidate.sizeLabel }.prefix(4), id: \.self) { SpecBadge($0) }
                }
                Text([candidate.sizeLabel, candidate.seeders.map { "\($0) seeders" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.stFootnote).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: Metrics.space2)
            switch candidate.availability {
            case .ready: ProviderBadge(ProviderKind(rawValue: candidate.provider.rawValue) ?? .local)
            case .cached: AvailabilityLabel(.instant)
            case .uncached: AvailabilityLabel(.download)
            }
        }
        .padding(Metrics.space4)
        .contentShape(Rectangle())
    }
}
