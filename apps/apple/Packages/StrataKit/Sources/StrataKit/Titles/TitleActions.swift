import Foundation

/// What Play does for a title: the button's label and what it starts.
public struct PlayChoice: Sendable, Hashable {
    /// "Play", "Resume", "Play S1 · E2", "Resume S1 · E2".
    public var label: String
    public var target: PlaybackTarget
    /// A source the server found beyond its library; nil plays from the library (the server chooses).
    public var candidateId: String?
    /// For the player: the episode ("S1 · E2 · Pilot"), or the movie's year.
    public var subtitle: String?

    public init(label: String, target: PlaybackTarget, candidateId: String? = nil, subtitle: String? = nil) {
        self.label = label
        self.target = target
        self.candidateId = candidateId
        self.subtitle = subtitle
    }
}

/// A title's Play, and the sources the server listed for it (for a Sources button).
public struct PlayOptions: Sendable, Hashable {
    /// nil: nothing to play (or, before the server is asked, nothing the library alone can play).
    public var choice: PlayChoice?
    /// What the server can play it from; empty until it's asked.
    public var sources: [Candidate]
    /// Whether the server has been asked. Before then, only the library answers.
    public var asked: Bool
    /// Whether the server looked beyond its library. When it didn't, a source picker can ask it to.
    public var lookedFurther: Bool

    public init(choice: PlayChoice? = nil, sources: [Candidate] = [], asked: Bool = false, lookedFurther: Bool = false) {
        self.choice = choice
        self.sources = sources
        self.asked = asked
        self.lookedFurther = lookedFurther
    }
}

/// Something on My List, watched, or on Continue Watching changed. Screens showing those
/// (Home, title pages) reload on any of them.
public enum TitleChange: Sendable, Hashable {
    case list(TitleRef, on: Bool)
    case watched(PlaybackTarget, Bool)
    case hiddenFromContinue(TitleRef)
    /// Playback stopped and its position was saved.
    case progress

    /// A show joining or leaving My List moves its episodes on or off the calendar (and
    /// its episode notifications).
    public var changesCalendar: Bool {
        if case .list = self { return true }
        return false
    }
}

/// What the app does with a title, worked out in one place: what Play does (a movie, a
/// show's Up Next episode, from the library or a source the server found), and changes
/// to My List, watched and Continue Watching, followed by one `changes` signal.
///
/// One per app: it asks `client` each time, so a server switch or failover is picked up.
/// The client clears its cached responses after each change; `changes` tells screens to
/// reload from it.
public final class TitleActions: Sendable {
    /// Every change made here, in order. One listener (the app).
    public let changes: AsyncStream<TitleChange>
    private let continuation: AsyncStream<TitleChange>.Continuation
    private let client: @Sendable () async -> StrataClient?
    private let recover: @Sendable (Error) async -> Bool

    /// - Parameters:
    ///   - client: the active server's client, or nil when signed out.
    ///   - recover: given a failure, true when `client` now answers differently (another
    ///     address): the request is tried once more.
    public init(client: @escaping @Sendable () async -> StrataClient?,
                recover: @escaping @Sendable (Error) async -> Bool = { _ in false }) {
        self.client = client
        self.recover = recover
        (changes, continuation) = AsyncStream.makeStream(of: TitleChange.self)
    }

    public convenience init(client: StrataClient) {
        self.init(client: { client })
    }

    deinit { continuation.finish() }

    // MARK: - Play

    /// Play for a movie page, from the library alone (no request): shown until `play(_:)` answers.
    public static func libraryPlay(_ movie: MovieDetail) -> PlayOptions {
        guard movie.isAvailable else { return PlayOptions() }
        return PlayOptions(choice: PlayChoice(label: movie.resumeMs != nil ? "Resume" : "Play", target: movie.target, subtitle: movie.yearText))
    }

    /// Play for a show page, from the library alone: its Up Next episode when it's in the library.
    public static func libraryPlay(_ show: ShowDetail) -> PlayOptions {
        guard let next = show.upNext, next.isAvailable else { return PlayOptions() }
        return PlayOptions(choice: upNextChoice(show, next, candidateId: nil))
    }

    /// Play for a card (the Home hero), from the library alone: a movie in the library. A
    /// show's Up Next takes its page, so it waits for `play(_:)`.
    public static func libraryPlay(_ card: TitleCard) -> PlayOptions {
        guard card.type == .movie, card.isAvailable else { return PlayOptions() }
        return PlayOptions(choice: PlayChoice(label: "Play", target: .movie(card.ref), subtitle: card.yearText))
    }

    /// Play for a movie page. In the library it plays from there (the sources are the
    /// library's); otherwise the server looks further, and Play takes the first it finds.
    public func play(_ movie: MovieDetail) async -> PlayOptions {
        let found = await sources(movie.target, discover: !movie.isAvailable)
        var options = Self.libraryPlay(movie)
        if options.choice == nil, let first = found.first {
            options.choice = PlayChoice(label: movie.resumeMs != nil ? "Resume" : "Play", target: movie.target, candidateId: first.id, subtitle: movie.yearText)
        }
        options.sources = found
        options.asked = true
        options.lookedFurther = !movie.isAvailable
        return options
    }

    /// Play for a show page: its Up Next episode, from the library or the first source the
    /// server finds. Nothing when there's no Up Next.
    public func play(_ show: ShowDetail) async -> PlayOptions {
        guard let next = show.upNext else { return PlayOptions(asked: true) }
        let found = await sources(.episode(show: show.ref, season: next.season, episode: next.episode), discover: !next.isAvailable)
        var options = Self.libraryPlay(show)
        if options.choice == nil, let first = found.first {
            options.choice = Self.upNextChoice(show, next, candidateId: first.id)
        }
        options.sources = found
        options.asked = true
        options.lookedFurther = !next.isAvailable
        return options
    }

    /// Play for a card, as its page would answer it: a show's Up Next episode, and for a
    /// title not in the library, the first source the server finds. Only `choice` is set.
    public func play(_ card: TitleCard) async -> PlayOptions {
        switch card.type {
        case .movie:
            let library = Self.libraryPlay(card)
            if library.choice != nil { return PlayOptions(choice: library.choice, asked: true) }
            let found = await sources(.movie(card.ref), discover: true)
            return PlayOptions(choice: found.first.map { PlayChoice(label: "Play", target: .movie(card.ref), candidateId: $0.id, subtitle: card.yearText) },
                               asked: true, lookedFurther: true)
        case .show:
            guard let show = try? await perform({ try await $0.show(card.ref) }) else { return PlayOptions(asked: true) }
            // In the library, no need to ask what else it could play from.
            let library = Self.libraryPlay(show)
            if library.choice != nil { return PlayOptions(choice: library.choice, asked: true) }
            let options = await play(show)
            return PlayOptions(choice: options.choice, asked: true, lookedFurther: options.lookedFurther)
        }
    }

    /// Play for an episode row: from the library, else the first source the server finds.
    /// Nil when it has nothing ("isn't in your library").
    public func play(_ episode: EpisodeItem, of show: TitleRef) async -> PlayChoice? {
        let subtitle = "\(episode.code) · \(episode.name)"
        let target = episode.target(show: show)
        if episode.isAvailable { return PlayChoice(label: "Play", target: target, subtitle: subtitle) }
        guard let first = await sources(target, discover: true).first else { return nil }
        return PlayChoice(label: "Play", target: target, candidateId: first.id, subtitle: subtitle)
    }

    private static func upNextChoice(_ show: ShowDetail, _ next: UpNext, candidateId: String?) -> PlayChoice {
        PlayChoice(label: "\(next.isResume ? "Resume" : "Play") \(next.code)",
                   target: .episode(show: show.ref, season: next.season, episode: next.episode),
                   candidateId: candidateId, subtitle: next.code)
    }

    /// `discover` lets the server look beyond its library (a few seconds, and calls whatever
    /// services it uses), so it's asked only where that decides whether it can play.
    /// Empty when it has nothing or the request fails.
    private func sources(_ target: PlaybackTarget, discover: Bool) async -> [Candidate] {
        (try? await perform { try await $0.sources(target, discover: discover) }) ?? []
    }

    // MARK: - Changes

    /// Adds a title to My List or takes it off.
    public func setOnList(_ ref: TitleRef, _ on: Bool) async throws {
        try await perform { try await $0.setWatchlist(ref, on) }
        continuation.yield(.list(ref, on: on))
    }

    /// Marks a movie or episode watched (it leaves Continue Watching) or unwatched.
    public func setWatched(_ target: PlaybackTarget, _ watched: Bool) async throws {
        try await perform { try await $0.setWatched(target, watched) }
        continuation.yield(.watched(target, watched))
    }

    /// Takes a title off Continue Watching until it's watched again; its progress is kept.
    public func hideFromContinue(_ ref: TitleRef) async throws {
        try await perform { try await $0.hideFromContinue(ref) }
        continuation.yield(.hiddenFromContinue(ref))
    }

    /// Playback of `target` stopped and its final position was saved (by the player's own
    /// client, so its page is dropped from this one's cache here): Continue Watching and
    /// Resume move on.
    public func progressSaved(_ target: PlaybackTarget?) async {
        if let target { await client()?.forget(target) }
        continuation.yield(.progress)
    }

    private func perform<T: Sendable>(_ work: @Sendable (StrataClient) async throws -> T) async throws -> T {
        guard let current = await client() else { throw StrataError(kind: .network, message: "Not connected to a server.") }
        do {
            return try await work(current)
        } catch {
            guard !(error is CancellationError), await recover(error), let retry = await client() else { throw error }
            return try await work(retry)
        }
    }
}
