import SwiftUI
import StrataKit
import StrataDesign

/// A cast or crew member: photo, life dates, biography, and the movies and shows
/// they've been in, most popular first.
struct PersonView: View {
    @Environment(AppServices.self) private var services
    let personId: Int
    @State private var person: Loadable<PersonDetail> = .loading
    @State private var bioExpanded = false

    var body: some View {
        ScrollView {
            switch person {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, minHeight: 400)
            case .failed(let message):
                MessageView(systemImage: "person.crop.circle.badge.exclamationmark", title: "Couldn't load this person", message: message, actionTitle: "Try Again") {
                    Task { await load() }
                }
                .frame(minHeight: 400)
            case .loaded(let p):
                VStack(alignment: .leading, spacing: Metrics.railGap) {
                    header(p)
                    credits("Movies", p.movies)
                    credits("Shows", p.shows)
                }
                .padding(.vertical, Metrics.space6)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .fullBleedOnTV()
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline) // the header carries the name
        #endif
        .task { await load() }
    }

    private func header(_ p: PersonDetail) -> some View {
        HStack(alignment: .top, spacing: Metrics.space6) {
            AsyncImage(url: p.profileUrl) { phase in
                if case .success(let image) = phase { image.resizable().scaledToFill() } else {
                    Theme.surface2.overlay { Text(p.name.prefix(1)).font(.stDisplay).foregroundStyle(Theme.ink3) }
                }
            }
            .frame(width: photo, height: photo * 1.5)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Metrics.space2) {
                if let role = p.knownFor { Text(role == "Acting" ? "Actor" : role).eyebrowStyle() }
                Text(p.name).font(.stTitle1).titleTracking().foregroundStyle(Theme.ink).accessibilityAddTraits(.isHeader)
                if let life = p.lifeText { Text(life).font(.stCallout).foregroundStyle(Theme.ink2) }
                if let bio = p.biography {
                    Button { withAnimation(.easeOut(duration: 0.2)) { bioExpanded.toggle() } } label: {
                        VStack(alignment: .leading, spacing: Metrics.space1) {
                            Text(bio)
                                .font(.stCallout)
                                .foregroundStyle(Theme.ink2)
                                .lineLimit(bioExpanded ? nil : bioLines)
                                .multilineTextAlignment(.leading)
                            Text(bioExpanded ? "Less" : "More").font(.stFootnote.weight(.semibold)).foregroundStyle(Theme.accentText)
                        }
                        .frame(maxWidth: 760, alignment: .leading)
                    }
                    #if os(tvOS)
                    .buttonStyle(FocusLiftStyle(inset: Metrics.space4))
                    #else
                    .buttonStyle(.plain)
                    #endif
                    .padding(.top, Metrics.space2)
                }
            }
        }
        .padding(.horizontal, Metrics.gutter)
    }

    @ViewBuilder private func credits(_ title: String, _ cards: [TitleCard]) -> some View {
        if !cards.isEmpty {
            Rail(title) {
                ForEach(cards) { card in
                    NavigationLink(value: card.route) { PosterCardLabel(card: card) }.buttonStyle(StrataCardStyle())
                }
            }
        }
    }

    #if os(tvOS)
    private let photo: CGFloat = 260
    private let bioLines = 5
    #else
    private var photo: CGFloat { Metrics.isPad ? 180 : 110 }
    private var bioLines: Int { Metrics.isPad ? 5 : 4 }
    #endif

    private func load() async {
        let result = await services.load { try await $0.person(personId) }
        if case .loading = result { return }
        person = result
    }
}


