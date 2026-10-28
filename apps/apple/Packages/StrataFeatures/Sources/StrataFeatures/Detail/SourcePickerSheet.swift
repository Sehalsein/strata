import SwiftUI
import StrataKit
import StrataDesign

/// "Choose a Source": whatever the server lists for a title, in its own words. Opened only
/// where the server has sources to offer.
struct SourcePickerSheet: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    let target: PlaybackTarget
    let title: String
    /// Sources the page already has.
    var known: [Candidate] = []
    /// Ask the server to look further than `known` (its library) when the sheet opens; if it
    /// can't or won't, `known` is what's shown.
    var lookFurther = true
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
                            Text("Looking for sources…").font(.stCallout).foregroundStyle(Theme.ink2)
                        }
                        .padding(.vertical, Metrics.space8)
                    case .failed(let message):
                        MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load sources", message: message)
                    case .loaded(let all):
                        let shown = all.filter(filter.matches)
                        if shown.isEmpty {
                            MessageView(systemImage: "rectangle.stack.badge.minus", title: "No sources", message: filter == .all ? "There's nothing to play this from." : "Try another quality.")
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
            #if !os(tvOS)
            // On tvOS the remote's Menu button closes the sheet, and the title needs the room.
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            #endif
        }
        .presentationDetents([.medium, .large])
        .task {
            guard lookFurther else { sources = .loaded(known); return }
            if !known.isEmpty { sources = .loaded(known) } // shown while the server looks further
            let found = await services.sources(for: target, discover: true)
            sources = .loaded(found.isEmpty ? known : found)
        }
    }
}

struct SourceRow: View {
    let candidate: Candidate

    var body: some View {
        HStack(alignment: .top, spacing: Metrics.space3) {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                Text(candidate.displayName).font(.stHeadline).foregroundStyle(Theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                HStack(spacing: Metrics.space2) {
                    ForEach(candidate.specLabels.prefix(4), id: \.self) { SpecBadge($0) }
                }
                if let detail = candidate.detail ?? candidate.sizeLabel {
                    Text(detail).font(.stFootnote).foregroundStyle(Theme.ink3)
                }
            }
            Spacer(minLength: Metrics.space2)
            switch candidate.readiness {
            case .ready: OriginBadge(candidate.originLabel ?? "Library")
            case .instant: AvailabilityLabel(.instant)
            case .download: AvailabilityLabel(.download)
            }
        }
        .padding(Metrics.space4)
        .contentShape(Rectangle())
    }
}
