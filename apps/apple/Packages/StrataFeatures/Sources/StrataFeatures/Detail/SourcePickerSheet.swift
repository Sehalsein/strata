import SwiftUI
import StrataKit
import StrataDesign

/// "Choose Source": whatever the server lists for a title, in its own words. Opened only
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
    /// Picking what to play, or what to download (sizes and free space matter more).
    var purpose: Purpose = .play
    /// The copy playing now (from the player): marked, and listed first.
    var current: String? = nil
    let onChoose: (Candidate) -> Void

    enum Purpose { case play, download }

    @State private var sources: Loadable<[Candidate]> = .loading
    #if os(tvOS)
    /// Focus starts on the first copy, not the quality filter, once the list is in.
    @FocusState private var focusedRow: String?
    #endif
    @State private var filter: Filter = .all

    /// The source you chose last time, which Play goes back to.
    private var lastPicked: String? {
        services.client.flatMap { SourceMemory.shared.pick(for: target, server: $0.baseURL) }
    }

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", uhd = "4K", hd = "1080p", sd = "720p"
        var id: String { rawValue }
        var title: String { self == .all ? String(localized: "All", bundle: .module) : rawValue }
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
        #if os(tvOS)
        tvBody
            .task { await load() }
        #else
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    filterPicker
                    #if os(iOS)
                    if purpose == .download, let free = DownloadStore.freeSpace, let text = Formatting.size(bytes: Int(free)) {
                        Text("\(text) free on this device", bundle: .module).font(.stFootnote).foregroundStyle(Theme.ink3)
                    }
                    #endif
                    list
                }
                .padding(Metrics.space5)
            }
            .navigationTitle(heading)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel", bundle: .module)) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
        #endif
    }

    private var heading: String { purpose == .download ? String(localized: "Download", bundle: .module) : String(localized: "Choose Source", bundle: .module) }

    private var filterPicker: some View {
        Picker(String(localized: "Quality", bundle: .module), selection: $filter) {
            ForEach(Filter.allCases) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
    }

    private func load() async {
        guard lookFurther else { sources = .loaded(known); return }
        if !known.isEmpty { sources = .loaded(known) } // shown while the server looks further
        let found = await services.sources(for: target, discover: true)
        sources = .loaded(found.isEmpty ? known : found)
    }

    /// The copy playing now first; the rest in the server's order.
    private func ordered(_ list: [Candidate]) -> [Candidate] {
        guard let current, let i = list.firstIndex(where: { $0.id == current }) else { return list }
        var list = list
        list.insert(list.remove(at: i), at: 0)
        return list
    }

    private func choose(_ candidate: Candidate) {
        dismiss()
        onChoose(candidate)
    }

    @ViewBuilder private var list: some View {
        switch sources {
        case .loading:
            HStack(spacing: Metrics.space3) {
                ProgressView()
                Text("Looking for sources…", bundle: .module).font(.stCallout).foregroundStyle(Theme.ink2)
            }
            .padding(.vertical, Metrics.space8)
        case .failed(let message):
            MessageView(systemImage: "exclamationmark.triangle", title: String(localized: "Couldn't load sources", bundle: .module), message: message)
        case .loaded(let all):
            let shown = ordered(all.filter(filter.matches))
            if shown.isEmpty {
                MessageView(systemImage: "rectangle.stack.badge.minus", title: String(localized: "No sources", bundle: .module), message: filter == .all ? String(localized: "There's nothing to play this from.", bundle: .module) : String(localized: "Try another quality.", bundle: .module))
            } else {
                #if os(tvOS)
                // Native TV cards: each copy lifts with the system's focus effect.
                LazyVStack(spacing: Metrics.space6) {
                    ForEach(shown) { candidate in
                        Button { choose(candidate) } label: {
                            SourceRow(candidate: candidate, isCurrent: candidate.id == current,
                                      isLastPicked: purpose == .play && current == nil && candidate.id == lastPicked)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.card)
                        .focused($focusedRow, equals: candidate.id)
                    }
                }
                #else
                VStack(spacing: 0) {
                    ForEach(shown) { candidate in
                        Button { choose(candidate) } label: {
                            SourceRow(candidate: candidate, isCurrent: candidate.id == current,
                                      isLastPicked: purpose == .play && current == nil && candidate.id == lastPicked)
                        }
                        .buttonStyle(.plain)
                        if candidate.id != shown.last?.id { Divider().overlay(Theme.hairline) }
                    }
                }
                .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
                #endif
            }
        }
    }

    #if os(tvOS)
    /// Full screen on the TV: what you're choosing for and the quality filter on the left,
    /// the copies in a list on the right. Menu closes it.
    private var tvBody: some View {
        HStack(alignment: .top, spacing: Metrics.space20) {
            VStack(alignment: .leading, spacing: Metrics.space6) {
                Text(heading).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                Text(title).font(.stHeadline).foregroundStyle(Theme.ink2).lineLimit(3)
                filterPicker.padding(.top, Metrics.space4)
                if let count = sources.value?.filter(filter.matches).count, count > 0 {
                    Text("\(count) copies", bundle: .module).font(.stFootnote).foregroundStyle(Theme.ink3)
                }
            }
            .frame(width: 560, alignment: .leading)
            .focusSection()

            ScrollView {
                list
                    .padding(.vertical, Metrics.space8)
                    .padding(.horizontal, Metrics.space6)
            }
            .scrollClipDisabled()
            .focusSection()
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, Metrics.space12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.bg.ignoresSafeArea())
        .task(id: sources.value?.first?.id) {
            guard let first = ordered(sources.value?.filter(filter.matches) ?? []).first?.id, focusedRow == nil else { return }
            try? await Task.sleep(for: .milliseconds(100))
            focusedRow = first
        }
    }
    #endif
}

struct SourceRow: View {
    let candidate: Candidate
    var isCurrent = false
    var isLastPicked = false

    #if os(tvOS)
    private let inset = Metrics.space6
    #else
    private let inset = Metrics.space4
    #endif

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
                if isCurrent {
                    Label(String(localized: "Playing now", bundle: .module), systemImage: "play.circle.fill")
                        .font(.stFootnote.weight(.semibold))
                        .foregroundStyle(Theme.accentText)
                } else if isLastPicked {
                    Label(String(localized: "Your last pick", bundle: .module), systemImage: "checkmark.circle.fill")
                        .font(.stFootnote)
                        .foregroundStyle(Theme.accentText)
                }
            }
            Spacer(minLength: Metrics.space2)
            switch candidate.readiness {
            case .ready: OriginBadge(candidate.originLabel ?? String(localized: "Library", bundle: .module))
            case .instant: AvailabilityLabel(.instant)
            case .download: AvailabilityLabel(.download)
            }
        }
        .padding(inset)
        .contentShape(Rectangle())
    }
}
