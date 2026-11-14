import SwiftUI
import StrataKit
import StrataDesign

/// "Who's watching?": the profiles signed in on this device, across servers, plus "Add
/// Profile". Each profile is a person's sign-in; picking one switches the whole app to it.
struct WhoIsWatchingView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    /// Shown over the app rather than in its place.
    var isSheet = false

    @State private var addAccount = false
    /// tvOS focus starts on the active profile (or the first), not on "Add Profile".
    @FocusState private var focused: String?

    private var store: ServerStore { services.store }
    /// Server names only matter when the profiles span more than one.
    private var showsServers: Bool { Set(store.signIns.map(\.serverID)).count > 1 }

    var body: some View {
        VStack(spacing: Metrics.space8) {
            Text("Who's watching?", bundle: .module).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
            if let error = store.lastError {
                Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
                    .padding(.horizontal, Metrics.gutter)
            }
            AvatarRow {
                ForEach(store.signIns) { signIn in
                    Button {
                        pick(signIn)
                    } label: {
                        AvatarTile(name: signIn.name, seed: signIn.id, imageURL: store.imageURL(for: signIn),
                                   detail: showsServers ? store.server(for: signIn)?.name : nil,
                                   isKids: signIn.isKids, isCurrent: isSheet && signIn.id == store.activeID)
                    }
                    .cardButtonStyle()
                    .focused($focused, equals: signIn.id)
                    #if !os(tvOS)
                    .contextMenu {
                        Button(String(localized: "Remove from This Device", bundle: .module), systemImage: "minus.circle", role: .destructive) {
                            store.remove(signIn.id)
                            services.refreshClient()
                        }
                    }
                    #endif
                }
                Button {
                    addAccount = true
                } label: {
                    AvatarTile(name: "Add Profile", seed: "", systemImage: "plus")
                }
                .cardButtonStyle()
                .focused($focused, equals: "add")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .toolbar {
            if isSheet {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel", bundle: .module)) { dismiss() } }
            }
        }
        .onAppear { focused = store.activeID ?? store.signIns.first?.id ?? "add" }
        .pickerSheet(isPresented: $addAccount) {
            ConnectView(isAdding: true) { if isSheet { dismiss() } }
        }
    }

    private func pick(_ signIn: SavedSignIn) {
        store.switchTo(signIn.id)
        services.refreshClient()
        if isSheet { dismiss() }
    }
}

/// Signed in, but the profile can watch more than one library (it was invited to another
/// household on the server) and hasn't picked one: pick it. Also Settings › Library.
/// People only see "libraries": households stay a server and dashboard idea.
struct HouseholdPickerView: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss
    var isSheet = false

    @State private var households: Loadable<[HouseholdSummary]> = .loading
    @State private var choosing: String?
    @State private var error: String?
    @FocusState private var focused: String?

    var body: some View {
        VStack(spacing: Metrics.space8) {
            VStack(spacing: Metrics.space2) {
                Text("Choose a library", bundle: .module).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                Text("\(services.store.active?.name ?? "This profile") can watch more than one. Each has its own titles and lists.", bundle: .module)
                    .font(.stCallout).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            }
            .padding(.horizontal, Metrics.gutter)
            switch households {
            case .loading:
                ProgressView()
            case .failed(let message):
                MessageView(systemImage: "exclamationmark.triangle", title: String(localized: "Couldn't load libraries", bundle: .module), message: message, actionTitle: String(localized: "Try Again", bundle: .module)) {
                    Task { await load() }
                }
            case .loaded(let list):
                VStack(spacing: Metrics.space2) {
                    ForEach(list) { household in
                        Button {
                            Task { await choose(household) }
                        } label: {
                            HStack(spacing: Metrics.space4) {
                                Image(systemName: "play.rectangle.on.rectangle").font(.stHeadline).foregroundStyle(Theme.ink2).frame(width: 32)
                                Text(household.name).font(.stHeadline).foregroundStyle(Theme.ink)
                                Spacer(minLength: Metrics.space2)
                                if choosing == household.id {
                                    ProgressView()
                                } else if household.id == services.store.active?.household?.id {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.accentText)
                                }
                            }
                            .padding(Metrics.space4)
                            .contentShape(Rectangle())
                        }
                        #if os(tvOS)
                        .buttonStyle(.card)
                        #else
                        .buttonStyle(.plain)
                        .background(Theme.surface1, in: RoundedRectangle(cornerRadius: Metrics.radiusMD, style: .continuous))
                        #endif
                        .focused($focused, equals: household.id)
                        .disabled(choosing != nil)
                    }
                }
                .frame(maxWidth: 560)
                .padding(.horizontal, Metrics.gutter)
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
            }
            if !isSheet {
                Button(String(localized: "Switch Profile", bundle: .module)) { services.store.deactivate() }
                    .font(.stCallout)
                    #if !os(tvOS)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.accentText)
                    #endif
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .toolbar {
            if isSheet {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel", bundle: .module)) { dismiss() } }
            }
        }
        .task { await load() }
        .onChange(of: households.value?.first?.id) { _, first in
            if focused == nil { focused = services.store.active?.household?.id ?? first }
        }
    }

    private func load() async {
        households = .loading
        do {
            households = .loaded(try await services.store.households())
        } catch {
            households = .failed(StrataError.wrap(error).message)
        }
    }

    private func choose(_ household: HouseholdSummary) async {
        choosing = household.id
        error = nil
        defer { choosing = nil }
        do {
            try await services.store.chooseHousehold(household.id)
            services.refreshClient()
            if isSheet { dismiss() }
        } catch {
            self.error = StrataError.wrap(error).message
        }
    }
}

/// On a home server's network: pick who you are, no password. The session can watch but
/// not administer; signing in with the password stays one tap away.
struct JoinMemberPickerView: View {
    @Environment(AppServices.self) private var services
    let target: ServerTarget
    let onSignedIn: () -> Void

    @State private var choices: Loadable<HomeJoinChoices> = .loading
    @State private var joining: String?
    @State private var usePassword = false
    @FocusState private var focused: String?

    var body: some View {
        VStack(spacing: Metrics.space8) {
            VStack(spacing: Metrics.space2) {
                Text("Who's watching?", bundle: .module).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink)
                Text(target.info.serverName)
                    .font(.stCallout).foregroundStyle(Theme.ink2)
            }
            switch choices {
            case .loading:
                ProgressView()
            case .failed(let message):
                MessageView(systemImage: "person.crop.circle.badge.exclamationmark", title: String(localized: "Couldn't load profiles", bundle: .module), message: message, actionTitle: String(localized: "Try Again", bundle: .module)) {
                    Task { await load() }
                }
            case .loaded(let home):
                AvatarRow {
                    ForEach(home.members) { member in
                        Button {
                            Task { await join(member) }
                        } label: {
                            AvatarTile(name: member.name, seed: SavedSignIn.id(server: target.info.id, user: member.id),
                                       imageURL: member.image.flatMap { URL(string: $0, relativeTo: target.url)?.absoluteURL },
                                       isKids: member.isKids, isBusy: joining == member.id)
                        }
                        .cardButtonStyle()
                        .focused($focused, equals: member.id)
                        .disabled(joining != nil)
                    }
                }
            }
            if let error = services.store.lastError, joining == nil, choices.value != nil {
                Label(error, systemImage: "exclamationmark.triangle.fill").font(.stFootnote).foregroundStyle(Theme.danger)
            }
            Button(String(localized: "Sign In with a Password", bundle: .module)) { usePassword = true }
                .font(.stCallout)
                #if !os(tvOS)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.accentText)
                #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
        .onChange(of: choices.value?.members.first?.id) { _, first in
            if focused == nil { focused = first }
        }
        .navigationDestination(isPresented: $usePassword) {
            #if os(tvOS)
            // Typing a password with the remote is slow; approving from a phone isn't.
            TVCodeSignInView(target: target, onSignedIn: onSignedIn)
            #else
            SignInView(target: target, onSignedIn: onSignedIn)
            #endif
        }
    }

    private func load() async {
        choices = .loading
        do {
            choices = .loaded(try await services.store.homeJoinChoices(url: target.url))
        } catch {
            choices = .failed(StrataError.wrap(error).message)
        }
    }

    private func join(_ member: HomeJoinChoices.Member) async {
        joining = member.id
        defer { joining = nil }
        if await services.store.join(url: target.url, info: target.info, userId: member.id) {
            onSignedIn()
        }
    }
}

// MARK: - Avatar tiles

/// A row of avatar tiles: centred when they fit, scrolling when they don't.
private struct AvatarRow<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @State private var rowWidth: CGFloat = 0

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: Metrics.isPadOrTV ? Metrics.space8 : Metrics.space6) { // top: a Kids label mustn't lift its avatar
                content()
            }
            // Three accounts fit across an iPhone; more scroll.
            .padding(.vertical, Metrics.space8)
            .padding(.horizontal, Metrics.isPadOrTV ? Metrics.space8 : Metrics.gutter)
            // At least the screen's width, centred; wider scrolls.
            .frame(minWidth: rowWidth)
        }
        .scrollClipDisabled()
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { rowWidth = $0 }
    }
}

/// An account's avatar with its name, and what sets it apart (server, Kids).
private struct AvatarTile: View {
    let name: String
    let seed: String
    var imageURL: URL?
    var detail: String?
    var isKids = false
    var isCurrent = false
    var isBusy = false
    var systemImage: String?

    #if os(tvOS)
    private let size: CGFloat = 160
    #else
    private let size: CGFloat = 96
    #endif

    var body: some View {
        VStack(spacing: Metrics.space3) {
            ZStack {
                if let systemImage {
                    Circle().fill(Theme.surface2).frame(width: size, height: size)
                        .overlay { Image(systemName: systemImage).font(.system(size: size * 0.32, weight: .medium)).foregroundStyle(Theme.ink2) }
                } else {
                    ProfileAvatar(name: name, seed: seed, size: size, imageURL: imageURL)
                }
                if isBusy { ProgressView() }
            }
            .overlay {
                if isCurrent { Circle().stroke(Theme.accentText, lineWidth: 3).frame(width: size + 8, height: size + 8) }
            }
            Text(name)
                .font(.stCallout.weight(.medium))
                .foregroundStyle(Theme.ink2)
            if let detail {
                Text(detail).font(.stFootnote).foregroundStyle(Theme.ink3)
            }
            if isKids {
                Text("Kids", bundle: .module).eyebrowStyle(Theme.accentText)
            }
        }
        .lineLimit(1)
        .fixedSize()
    }
}
