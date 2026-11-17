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

    @State private var sources: Loadable<SourceList> = .loading
    #if os(tvOS)
    /// Focus starts on the first copy, not the quality filter, once the list is in.
    @FocusState private var focusedRow: String?
    #endif
    /// The filters you set, kept per server (SourceFilterMemory): the option picked in each
    /// of the server's groups, and the quality filter for servers that send none (older ones).
    @State private var saved = SourceFilterMemory.Filters()
    /// The server's list is in: until then its filters aren't known, so none are drawn.
    @State private var answered = false
    /// The server is still looking (further than the library, or again for Refresh).
    @State private var looking = false

    /// The source you chose last time, which Play goes back to.
    private var lastPicked: String? {
        services.client.flatMap { SourceMemory.shared.pick(for: target, server: $0.baseURL) }
    }

    /// Older servers' fallback: the quality picker the app used to work out itself.
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel", bundle: .module)) { dismiss() } }
                if lookFurther {
                    ToolbarItem(placement: .primaryAction) { refreshButton }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
        #endif
    }

    private var heading: String { purpose == .download ? String(localized: "Download", bundle: .module) : String(localized: "Choose Source", bundle: .module) }

    /// The server's filter groups, once its list is in and when it sends them; else the old quality picker.
    private var groups: [SourceFilterGroup] { answered ? sources.value?.filters ?? [] : [] }

    /// The quality filter for servers that send none; none applies until the server answers.
    private var filter: Filter { answered ? saved.quality.flatMap(Filter.init(rawValue:)) ?? .all : .all }

    /// Of the saved options, those this title's list offers (the rest wait for another title).
    private var picked: [String: String] { answered ? sources.value?.applicable(saved.picked) ?? [:] : [:] }

    /// What's shown: the sources matching the picked options.
    private var shownSources: [Candidate] {
        guard let list = sources.value else { return [] }
        return groups.isEmpty ? list.items.filter(filter.matches) : list.matching(picked)
    }

    private var isFiltered: Bool { groups.isEmpty ? filter != .all : !picked.isEmpty }

    private var server: URL? { services.client?.baseURL }

    /// Changes the filters and keeps them for next time.
    private func setFilters(_ change: (inout SourceFilterMemory.Filters) -> Void) {
        change(&saved)
        if let server { SourceFilterMemory.shared.set(saved, server: server) }
    }

    @ViewBuilder private var filterPicker: some View {
        if !answered {
            EmptyView()
        } else if groups.isEmpty {
            HStack(spacing: Metrics.space2) {
                Picker(String(localized: "Quality", bundle: .module), selection: Binding(
                    get: { filter },
                    set: { value in setFilters { $0.quality = value == .all ? nil : value.rawValue } }
                )) {
                    ForEach(Filter.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                if isFiltered { clearButton }
            }
        } else {
            #if os(tvOS)
            VStack(alignment: .leading, spacing: Metrics.space3) {
                groupPickers
                if isFiltered { clearButton }
            }
            #else
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Metrics.space2) {
                    groupPickers
                    if isFiltered { clearButton }
                }
            }
            #endif
        }
    }

    /// Clears every filter, here and for next time.
    private var clearButton: some View {
        Button {
            setFilters { $0 = SourceFilterMemory.Filters() }
        } label: {
            Label(String(localized: "Clear", bundle: .module), systemImage: "xmark.circle.fill")
        }
        #if !os(tvOS)
        .buttonStyle(.borderless)
        .font(.stCallout)
        #endif
        .accessibilityLabel(String(localized: "Clear filters", bundle: .module))
    }

    /// Asks the server to search again.
    private var refreshButton: some View {
        Button {
            Task { await load(refresh: true) }
        } label: {
            Label(String(localized: "Refresh", bundle: .module), systemImage: "arrow.clockwise")
        }
        .disabled(looking)
        .accessibilityLabel(String(localized: "Refresh sources", bundle: .module))
    }

    /// One menu per group, as the server named it: "All" or one of its options (with counts).
    @ViewBuilder private var groupPickers: some View {
        ForEach(groups) { group in
            Picker(group.title, selection: Binding(
                get: { picked[group.id] ?? "" },
                set: { value in setFilters { $0.picked[group.id] = value.isEmpty ? nil : value } }
            )) {
                Text("\(group.title): \(String(localized: "All", bundle: .module))").tag("")
                ForEach(group.options) { option in
                    Text("\(option.label) (\(option.count))").tag(option.id)
                }
            }
            .pickerStyle(.menu)
            .fixedSize()
        }
    }

    /// The sources, with the filters you set last time. On opening, the page's own copies
    /// show (unfiltered) while the server looks further; Refresh starts over from nothing,
    /// so nothing from before shows as if it were the new answer.
    private func load(refresh: Bool = false) async {
        if let server, !refresh { saved = SourceFilterMemory.shared.filters(server: server) }
        guard lookFurther else { sources = .loaded(SourceList(items: known)); answered = true; return }
        answered = false
        looking = true
        defer { looking = false }
        if refresh || known.isEmpty { sources = .loading } else { sources = .loaded(SourceList(items: known)) }
        let found = await services.sourceList(for: target, discover: true, refresh: refresh)
        if let found, !found.items.isEmpty { sources = .loaded(found) } else { sources = .loaded(SourceList(items: known)) }
        answered = true
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
        case .loaded:
            let shown = ordered(shownSources)
            if looking {
                HStack(spacing: Metrics.space3) {
                    ProgressView()
                    Text("Looking for more sources…", bundle: .module).font(.stCallout).foregroundStyle(Theme.ink2)
                }
                .padding(.vertical, Metrics.space2)
            }
            if shown.isEmpty, !looking {
                MessageView(systemImage: "rectangle.stack.badge.minus", title: String(localized: "No sources", bundle: .module), message: isFiltered ? String(localized: "Nothing matches these filters. Try others.", bundle: .module) : String(localized: "There's nothing to play this from.", bundle: .module))
            } else if !shown.isEmpty {
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
                if lookFurther { refreshButton }
                if sources.value != nil, case let count = shownSources.count, count > 0 {
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
        .task(id: sources.value?.items.first?.id) {
            guard let first = ordered(shownSources).first?.id, focusedRow == nil else { return }
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
