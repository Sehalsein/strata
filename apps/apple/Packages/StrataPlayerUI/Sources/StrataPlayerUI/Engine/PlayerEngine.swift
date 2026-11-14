import Foundation
import AVFoundation
import Combine
import Observation
import StrataKit
import StrataRemux
#if canImport(UIKit)
import UIKit
#endif

/// What the player shows for the current title (Now Playing, chrome, Live Activity).
public struct PlaybackMeta: Sendable, Hashable {
    public var title: String
    /// e.g. the show name + "S1 · E2", or the year for a movie.
    public var subtitle: String?
    public var artworkURL: URL?

    public init(title: String, subtitle: String? = nil, artworkURL: URL? = nil) {
        self.title = title
        self.subtitle = subtitle
        self.artworkURL = artworkURL
    }
}

/// Drives AVPlayer against a Strata server session.
///
/// In device mode the server only hands over the file's link: StrataRemux repackages it
/// on the device and AVPlayer plays that from a loopback address. Video never streams
/// through the server (only files on its own disk do): a file the device can't play fails
/// with a message to pick another source.
///
/// Every time exposed here (`position`, `duration`, `seek(to:)`, chapters, subtitle cues) is
/// **media time** — seconds into the title — regardless of where the current HLS stream starts.
@MainActor
@Observable
public final class PlayerEngine {
    public enum Status: Equatable {
        case idle
        /// Asking the server for a stream / waiting for the first frames.
        case loading
        /// The server is getting the source ready; the engine asks again until it is.
        case preparing(PreparingStatus)
        case ready, playing, paused, ended
        case failed(String)
    }

    public private(set) var status: Status = .idle
    /// Set while a copy that wouldn't open is being passed over for another, to say so.
    public private(set) var fallbackNote: String?
    /// What a start is doing right now, for the loading screen. Only the steps this start
    /// actually goes through are set.
    public private(set) var loadingStep: LoadingStep?

    public enum LoadingStep: Equatable, Sendable {
        /// Asking the server what to play.
        case finding
        /// Reading the file's tracks for the server (the first time a file plays).
        case reading
        /// Opening the file over the network to play it on this device.
        case connecting
        /// The server is repackaging it; waiting for the stream's first part.
        case preparingStream
        /// Stream open; the player is buffering its first seconds.
        case buffering

        public var label: String {
            switch self {
            case .finding: String(localized: "Asking the server for the best copy…", bundle: .module)
            case .reading: String(localized: "Checking the file's video and audio…", bundle: .module)
            case .connecting: String(localized: "Connecting to the file…", bundle: .module)
            case .preparingStream: String(localized: "The server is getting the stream ready…", bundle: .module)
            case .buffering: String(localized: "Starting playback…", bundle: .module)
            }
        }

        /// Said instead once the step has run long.
        public var slowLabel: String {
            switch self {
            case .finding: String(localized: "The server is still looking for a copy. This can take a moment.", bundle: .module)
            case .reading: String(localized: "Still checking the file. Large files take longer.", bundle: .module)
            case .connecting: String(localized: "Still connecting to the file. The server holding it is slow to answer.", bundle: .module)
            case .preparingStream: String(localized: "The server is still getting the stream ready. This can take a moment.", bundle: .module)
            case .buffering: String(localized: "Still buffering. The connection is slow right now.", bundle: .module)
            }
        }
    }
    /// Media time, seconds.
    public private(set) var position: TimeInterval = 0 {
        didSet {
            updateActiveCues()
            updateCurrentChapter()
        }
    }
    /// Full title duration from the server (HLS EVENT playlists grow, so the item's own duration isn't used).
    public private(set) var duration: TimeInterval = 0
    /// AVPlayer is waiting for data (initial load, stall, or a seek restart).
    public private(set) var isBuffering = false
    public private(set) var isMuted = false
    public var rate: Float = 1.0 { didSet { applyRate() } }

    public private(set) var target: PlaybackTarget?
    public private(set) var meta: PlaybackMeta?
    /// The current server session: mode, candidate (source file), reasons, URLs.
    public private(set) var session: PlayResponse?
    #if os(tvOS)
    /// The frame rate and dynamic range the TV should switch to for this title (the player
    /// view hands it to its window's display manager); nil when nothing's playing.
    public private(set) var displayCriteria: AVDisplayCriteria?
    #endif
    /// Device mode: what the repackaging is doing, for Stream Details.
    public var remuxStats: RemuxSession.Stats? { remux?.stats }

    public private(set) var audioTracks: [AudioTrack] = []
    public private(set) var subtitleTracks: [SubtitleTrack] = []
    /// ffprobe index of the playing audio track.
    public private(set) var activeAudioIndex: Int?
    /// Id of the shown subtitle track (`SubtitleTrack.id`), nil when off.
    public private(set) var activeSubtitleId: String?
    public var captionsEnabled: Bool { activeSubtitleId != nil }
    public var activeSubtitle: SubtitleTrack? { subtitleTracks.first { $0.id == activeSubtitleId } }
    public private(set) var isLoadingSubtitles = false
    public private(set) var subtitleError: String?
    /// Parsed cues of the active track, in media time, sorted by start.
    public private(set) var subtitleCues: [VTTCue] = [] {
        didSet {
            longestCue = subtitleCues.reduce(0) { max($0, $1.end - $1.start) }
            activeCueIndices = nil
            updateActiveCues()
        }
    }
    /// Text to draw right now (overlapping cues joined by a newline), nil when nothing shows.
    /// Stored, and changed only when the cues showing change, so the overlay redraws then.
    public private(set) var activeCueText: String?
    /// Picture subtitles to draw right now.
    public private(set) var activeCueImages: [SubtitleImage] = []
    /// Which cues are showing (indices into `subtitleCues`), to tell when that changes.
    @ObservationIgnored private var activeCueIndices: [Int]?
    /// The longest cue: how far back from a time a cue can start and still show then.
    @ObservationIgnored private var longestCue: TimeInterval = 0
    /// The video's frame size (device mode), which picture subtitles are placed against.
    public var videoSize: CGSize? {
        guard let format = remux?.videoFormat, format.width > 0, format.height > 0 else { return nil }
        return CGSize(width: format.width, height: format.height)
    }
    /// Decoded pictures of the last few cues shown, so a redraw doesn't decode the PNG again.
    @ObservationIgnored private var decodedPictures: [SubtitleImage: CGImage] = [:]

    /// The picture subtitle as an image to draw.
    public func picture(_ image: SubtitleImage) -> CGImage? {
        if let decoded = decodedPictures[image] { return decoded }
        guard let source = CGImageSourceCreateWithData(image.png as CFData, nil),
              let decoded = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
        if decodedPictures.count >= 8 { decodedPictures.removeAll() }
        decodedPictures[image] = decoded
        return decoded
    }

    public private(set) var chapters: [Chapter] = [] { didSet { updateCurrentChapter() } }
    /// The chapter playing now; stored, so views reading it redraw only when it changes.
    public private(set) var currentChapter: Chapter?
    /// What Up Next should offer (episodes only).
    public private(set) var nextEpisode: NextEpisode?
    public var nextTarget: PlaybackTarget? {
        guard let target, let next = nextEpisode else { return nil }
        return target.with(season: next.season, episode: next.episode)
    }

    /// When the sleep timer will pause playback, if armed.
    public private(set) var sleepTimerEnds: Date?
    /// The sleep timer's chosen length, `.off` when it isn't armed (for the menu's checkmark).
    public private(set) var sleepOption: SleepOption = .off
    private var sleepTask: Task<Void, Never>?

    public enum SleepOption: Int, CaseIterable, Identifiable, Sendable {
        case off = 0, m15 = 15, m30 = 30, m45 = 45, m60 = 60
        public var id: Int { rawValue }
        public var label: String { self == .off ? String(localized: "Off", bundle: .module) : String(localized: "\(rawValue) min", bundle: .module) }
    }

    /// `.resizeAspect` (default) letterboxes; `.resizeAspectFill` crops to fill. Persisted.
    public var videoGravity: AVLayerVideoGravity {
        didSet { UserDefaults.standard.set(videoGravity.rawValue, forKey: Self.videoGravityKey) }
    }
    private static let videoGravityKey = "strata.videoGravity"

    public let player: AVPlayer = {
        let p = AVPlayer()
        p.automaticallyWaitsToMinimizeStalling = true
        p.appliesMediaSelectionCriteriaAutomatically = true
        p.allowsExternalPlayback = true
        return p
    }()

    public private(set) var client: StrataClient?
    private var nowPlaying: NowPlayingBridge?

    // Device mode
    /// Repackages the current file on the device (device mode only).
    private var remux: RemuxSession?
    /// Lines read so far from each embedded text track, by stream index, in media time.
    private var embeddedCues: [Int: [VTTCue]] = [:]
    /// The lines in `embeddedCues`, to drop ones read again.
    @ObservationIgnored private var embeddedCueKeys: [Int: Set<CueKey>] = [:]
    /// The stream's own subtitle tracks (embedded text tracks, as WebVTT), which the player
    /// draws itself: in Picture in Picture and on AirPlay too.
    private var nativeSubtitles: AVMediaSelectionGroup?
    /// The name each embedded track has in the stream, by `SubtitleTrack.id`.
    private var nativeSubtitleNames: [String: String] = [:]
    /// Set when the player refused this title's stream with subtitle tracks in it: it's
    /// repackaged without them, and the overlay shows the lines.
    private var skipNativeSubtitles = false

    // Session plumbing
    private var timeline = MediaTimeline(startOffset: 0, duration: 0, isHLS: false)
    private var loadTask: Task<Void, Never>?
    private var restartTask: Task<Void, Never>?
    private var subtitleTask: Task<Void, Never>?
    /// Bumped on every new load/unload; stale async work checks it before touching state.
    private var generation = 0
    /// Bumped by every load and restart: only the newest may install its item.
    @ObservationIgnored private var startToken = 0
    /// Bumped as soon as `load` is called; see `unload(ifCurrent:)`.
    public private(set) var loadToken = 0
    /// Playing when an audio interruption (a call, an alarm) began.
    @ObservationIgnored private var playingBeforeInterruption = false
    /// Playback was asked to run (and not paused since), whatever the player is doing now.
    @ObservationIgnored private var wantsToPlay = false
    @ObservationIgnored private var systemObservers: [NSObjectProtocol] = []
    /// Media time being restarted to; the timeline isn't trusted until the new item plays.
    private var restartTarget: TimeInterval?
    /// Files whose media info this load already read for the server (see `probe`).
    private var probedFiles = Set<Int>()
    /// The file last read for the server (`probe`), so a failed read can rule it out.
    private var lastProbedFile: Int?
    /// Other copies tried after the first one failed on this device, at most.
    private static let maxFallbacks = 3
    /// Device mode: waits out a stall, then reopens the stream where it stopped.
    private var stallTask: Task<Void, Never>?
    /// Times the device stream was reopened after a stall or failure, and where the last
    /// one was: a title that keeps failing at one spot stops trying.
    private var recoveries = 0
    private var recoveredAt: TimeInterval = 0
    @ObservationIgnored private var lastReportAt = Date.distantPast
    @ObservationIgnored private var lastReportedMs: Int?
    /// Set once the first item became ready; before that there's no real position to report
    /// (reporting 0 would wipe the saved resume point).
    private var didStartPlayback = false

    // Observers
    private var timeObserverToken: Any?
    private var statusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var externalObservation: NSKeyValueObservation?

    /// Told every position the engine reports (a download keeps where it was left).
    @ObservationIgnored public var onProgress: (@MainActor (PlaybackTarget, _ positionMs: Int, _ durationMs: Int) -> Void)?
    /// Told a position that couldn't reach the server, to send later.
    @ObservationIgnored public var onUndeliveredProgress: (@Sendable (PlaybackTarget, _ positionMs: Int, _ durationMs: Int) -> Void)?

    /// Progress is reported this often while playing.
    public var progressInterval: TimeInterval = 10
    /// How long rapid scrubs are coalesced before an HLS restart.
    public var restartDebounce: TimeInterval = 0.4
    /// How often a source the server is getting ready is asked about again.
    public var preparePollInterval: TimeInterval = 5
    /// How long the device stream may stall before it's reopened where it stopped.
    public var stallLimit: TimeInterval = 15
    /// Reopenings allowed before giving up (counted afresh after a minute of playing).
    private static let maxRecoveries = 3

    public init() {
        if let raw = UserDefaults.standard.string(forKey: Self.videoGravityKey) {
            videoGravity = AVLayerVideoGravity(rawValue: raw)
        } else {
            videoGravity = .resizeAspect
        }
        observeSystem()
    }

    public func configure(client: StrataClient, nowPlaying: NowPlayingBridge? = nil) {
        self.client = client
        if let nowPlaying { self.nowPlaying = nowPlaying }
    }

    // MARK: - Loading

    /// Starts playing `target`. `startMs` nil resumes from the server's saved progress;
    /// `candidateId` picks a source the server listed (else the server's choice). Returns once
    /// playback has started, failed, or the load was superseded (`unload()` / another `load`).
    public func load(target: PlaybackTarget, meta: PlaybackMeta, candidateId: String? = nil, startMs: Int? = nil) async {
        loadToken += 1
        guard let client else { status = .failed(String(localized: "Not connected to a server.", bundle: .module)); return }
        await teardown(reportFinal: true)
        generation += 1
        let gen = generation
        startToken += 1
        let token = startToken
        skipNativeSubtitles = false
        probedFiles = []
        lastProbedFile = nil
        recoveries = 0
        self.target = target
        self.meta = meta
        status = .loading
        position = startMs.map { TimeInterval($0) / 1000 } ?? 0
        nowPlaying?.update(meta: meta, position: position, duration: duration, rate: 0)

        fallbackNote = nil
        loadingStep = nil
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.loadWithFallback(client: client, target: target, candidateId: candidateId, startMs: startMs, gen: gen, token: token)
            } catch let failure as DeviceFailure {
                guard gen == self.generation else { return }
                Log.player.warning("device play failed: \(failure.message, privacy: .public)")
                self.fallbackNote = nil
                self.status = .failed(failure.message)
            } catch {
                guard gen == self.generation, !(error is CancellationError) else { return }
                let e = StrataError.wrap(error)
                self.fallbackNote = nil
                if e.kind != .cancelled { self.status = .failed(e.message) }
            }
        }
        loadTask = task
        await task.value
    }

    /// Plays a downloaded file (`res` from `DownloadItem.playResponse`) without the server:
    /// the same engine as a stream, reading the file from disk.
    public func load(offline res: PlayResponse, target: PlaybackTarget, meta: PlaybackMeta) async {
        loadToken += 1
        await teardown(reportFinal: true)
        generation += 1
        let gen = generation
        startToken += 1
        let token = startToken
        skipNativeSubtitles = false
        probedFiles = []
        recoveries = 0
        self.target = target
        self.meta = meta
        status = .loading
        position = TimeInterval(res.seekToMs) / 1000
        nowPlaying?.update(meta: meta, position: position, duration: duration, rate: 0)
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.start(res, gen: gen, token: token, newTitle: true, autoplay: true)
            } catch let failure as DeviceFailure {
                guard gen == self.generation else { return }
                self.status = .failed(failure.message)
            } catch {
                guard gen == self.generation, !(error is CancellationError) else { return }
                self.status = .failed(StrataError.wrap(error).message)
            }
        }
        loadTask = task
        await task.value
    }

    /// Plays the server's choice (or `candidateId`, or the copy you chose before). When the
    /// server's choice won't open on this device (its link doesn't connect, the file can't be
    /// read or decoded here), the next copy the server lists that's ready to play is tried,
    /// up to `maxFallbacks` of them; the one that plays is remembered for next time. A copy
    /// you picked yourself isn't swapped: its failure is shown, with Choose Source.
    private func loadWithFallback(client: StrataClient, target: PlaybackTarget, candidateId: String?, startMs: Int?, gen: Int, token: Int) async throws {
        let memory = SourceMemory.shared
        // A source you picked before for this (or, for a show, one like it).
        let remembered = candidateId == nil ? await rememberedSource(for: target, client: client) : nil
        var pick = candidateId ?? remembered
        var failedCandidates = Set<String>()
        var failedFiles = Set<Int>()
        var others: [Candidate]?
        var attempt = 0
        while true {
            try Task.checkCancellation()
            var res: PlayResponse?
            do {
                do {
                    res = try await requestPlay(client: client, target: target, candidateId: pick, startMs: startMs, audioIndex: nil, gen: gen)
                } catch let error as StrataError where attempt == 0 && pick == remembered && remembered != nil && error.kind == .http && [404, 410].contains(error.status ?? 0) {
                    // That file is gone: let the server choose again.
                    memory.forget(target, server: client.baseURL)
                    pick = nil
                    res = try await requestPlay(client: client, target: target, candidateId: nil, startMs: startMs, audioIndex: nil, gen: gen)
                }
                try await start(res!, gen: gen, token: token, newTitle: true, autoplay: true)
                fallbackNote = nil
                loadingStep = nil
                // Your pick, or a copy that played after others didn't: start with it next time.
                if candidateId != nil || attempt > 0 { memory.remember(res!.candidate, for: target, server: client.baseURL) }
                return
            } catch let failure as DeviceFailure {
                guard gen == generation else { throw CancellationError() }
                guard candidateId == nil else { throw failure }
                guard attempt < Self.maxFallbacks else {
                    throw DeviceFailure(message: String(localized: "Tried \(attempt + 1) copies and none would play here. Choose another source.", bundle: .module))
                }
                if let res {
                    failedCandidates.insert(res.candidate.id)
                    failedFiles.insert(res.candidate.fileId)
                } else if let lastProbedFile {
                    failedFiles.insert(lastProbedFile)
                }
                if let pick { failedCandidates.insert(pick) }
                if pick == remembered, remembered != nil { memory.forget(target, server: client.baseURL) }
                if others == nil { others = (try? await client.sources(target, discover: false)) ?? [] }
                guard gen == generation else { throw CancellationError() }
                // Ready now or shortly; not one the server would have to download first.
                guard let next = others?.first(where: { !failedCandidates.contains($0.id) && !failedFiles.contains($0.fileId) && $0.readiness != .download }) else {
                    // Say how far it got, so "Pick another source" isn't the first you hear of it.
                    if attempt > 0 { throw DeviceFailure(message: String(localized: "Tried \(attempt + 1) copies and none would play here. Choose another source.", bundle: .module)) }
                    throw failure
                }
                Log.player.warning("copy failed (\(failure.message, privacy: .public)); trying \(next.id, privacy: .public)")
                attempt += 1
                pick = next.id
                fallbackNote = Self.fallbackNote(after: failure, next: next, attempt: attempt)
                status = .loading
            }
        }
    }

    /// Why a copy's link wouldn't open. When its host doesn't answer, says so: that's the
    /// copy's own server (TorBox's, say), not your Strata server.
    nonisolated static func openFailure(_ error: Error) -> String {
        let ns = error as NSError
        let unreachable = ns.domain == NSURLErrorDomain && [NSURLErrorCannotConnectToHost, NSURLErrorTimedOut,
            NSURLErrorCannotFindHost, NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed].contains(ns.code)
        if unreachable || error.localizedDescription.lowercased().contains("connect") {
            return String(localized: "This copy's server didn't answer. Choose another source.", bundle: .module)
        }
        return String(localized: "This copy couldn't be opened (\(error.localizedDescription)). Choose another source.", bundle: .module)
    }

    /// What the player says while it switches: why the last copy was passed over, and
    /// which one it's trying ("That copy couldn't be reached. Switching to 1080p · WEB (2 of 4)…").
    private static func fallbackNote(after failure: DeviceFailure, next: Candidate, attempt: Int) -> String {
        let text = failure.message.lowercased()
        let why = text.contains("connect") || text.contains("timed out") || text.contains("network")
            ? String(localized: "That copy couldn't be reached.", bundle: .module)
            : text.contains("can't play on this device") || text.contains("dolby vision") || text.contains("hdr")
            ? String(localized: "That copy won't play on this device.", bundle: .module)
            : String(localized: "That copy wouldn't open.", bundle: .module)
        let label = [next.resolutionLabel, next.source?.uppercased()].compactMap { $0 }.joined(separator: " · ")
        let what = label.isEmpty ? String(localized: "another source", bundle: .module) : label
        return String(localized: "\(why) Switching to \(what) (try \(attempt + 1) of \(maxFallbacks + 1))…", bundle: .module)
    }

    /// The source you chose for `target` before, or for a show the episode's copy most like
    /// the one you chose for another episode (asked of the library only, which is quick).
    private func rememberedSource(for target: PlaybackTarget, client: StrataClient) async -> String? {
        let memory = SourceMemory.shared
        if let id = memory.pick(for: target, server: client.baseURL) { return id }
        guard memory.hasShowPreference(target, server: client.baseURL),
              let sources = try? await client.sources(target, discover: false) else { return nil }
        return memory.match(sources, for: target, server: client.baseURL)?.id
    }

    /// Plays the next episode (from `nextEpisode`), from the start.
    public func playNext(meta: PlaybackMeta? = nil) async {
        guard let next = nextEpisode, let nextTarget else { return }
        let m = meta ?? PlaybackMeta(title: next.name, subtitle: next.code, artworkURL: next.stillUrl ?? self.meta?.artworkURL)
        await load(target: nextTarget, meta: m, startMs: 0)
    }

    /// Calls `/api/play`, asking again while the server gets the source ready (`.preparing`).
    /// `candidateId` keeps a restart (seek, audio switch) on the same file.
    private func requestPlay(client: StrataClient, target: PlaybackTarget, candidateId: String?, startMs: Int?, audioIndex: Int?, gen: Int) async throws -> PlayResponse {
        var candidateId = candidateId
        while true {
            try Task.checkCancellation()
            loadingStep = .finding
            switch try await client.play(target, candidateId: candidateId, startMs: startMs, audioStreamIndex: audioIndex) {
            case .started(let res):
                guard gen == generation, !Task.isCancelled else {
                    // Started for nothing: don't leave it running on the server.
                    if res.sessionId != session?.sessionId { stopSession(res.sessionId) }
                    throw CancellationError()
                }
                return res
            case .preparing(let progress):
                guard gen == generation else { throw CancellationError() }
                status = .preparing(progress)
                try await Task.sleep(nanoseconds: UInt64(preparePollInterval * 1_000_000_000))
            case .needsProbe(let fileId, let url):
                guard gen == generation else { throw CancellationError() }
                try await probe(fileId: fileId, url: url, client: client, gen: gen)
                // Ask again for the same file: the one the server chose, if we didn't name one.
                candidateId = candidateId ?? "file:\(fileId)"
            }
        }
    }

    /// The server can't read files itself, so it asks the app for a file's media info the
    /// first time it plays it: read the header from the link and send it. Once per file per
    /// load, so a server that keeps asking can't loop forever.
    private func probe(fileId: Int, url: URL, client: StrataClient, gen: Int) async throws {
        lastProbedFile = fileId
        guard probedFiles.insert(fileId).inserted else {
            throw DeviceFailure(message: String(localized: "The server couldn't use what this file holds. Pick another source.", bundle: .module))
        }
        status = .loading
        let info: MediaInfo
        do {
            // MediaProbe reads on its own queue; the main actor only waits.
            loadingStep = .reading
            info = try await MediaProbe.probe(url: url)
        } catch {
            guard gen == generation, !(error is CancellationError) else { throw CancellationError() }
            Log.player.warning("probe failed: \(error.localizedDescription, privacy: .public)")
            throw DeviceFailure(message: String(localized: "This file couldn't be read (\(error.localizedDescription)). Pick another source.", bundle: .module))
        }
        guard gen == generation else { throw CancellationError() }
        try await client.reportProbe(fileId: fileId, info: info)
        guard gen == generation else { throw CancellationError() }
    }

    /// Whether a start (`gen`, `token`) is still the one wanted: a newer load or restart
    /// supersedes it, and it must never install its item.
    private func isCurrent(_ gen: Int, _ token: Int) -> Bool {
        gen == generation && token == startToken && !Task.isCancelled
    }

    /// Installs a play response as the current item. `newTitle` resets tracks/subtitles;
    /// otherwise (seek restart / audio switch) the subtitle selection and cues carry over.
    private func start(_ res: PlayResponse, gen: Int, token: Int, newTitle: Bool, autoplay: Bool) async throws {
        // A server session this start opened but never installed is stopped, however it ends.
        var installed = false
        defer { if !installed, res.sessionId != session?.sessionId { stopSession(res.sessionId) } }
        guard isCurrent(gen, token) else { throw CancellationError() }
        let previous = session
        let previousRemux = remux
        // Device mode: open the file and repackage it here before anything changes on screen.
        var url = res.url
        var newRemux: RemuxSession?
        if res.mode == .device {
            let local = makeRemux(res)
            do {
                // Built from the resume point, so the player begins there.
                loadingStep = .connecting
                url = try await local.start(at: TimeInterval(res.seekToMs) / 1000)
                #if os(iOS)
                // An Apple TV on AirPlay fetches the stream itself: it gets the Wi-Fi address.
                if player.isExternalPlaybackActive { url = try await local.networkPlaylistURL() }
                #endif
            } catch {
                local.stop()
                guard isCurrent(gen, token) else { throw CancellationError() }
                throw DeviceFailure(message: Self.openFailure(error))
            }
            guard isCurrent(gen, token) else { local.stop(); throw CancellationError() }
            newRemux = local
        }
        removeObservers()
        stallTask?.cancel()
        stallTask = nil

        session = res
        installed = true
        // The old server session ends now, so no later cancel or failure can leave it running.
        if let previous, previous.sessionId != res.sessionId { stopSession(previous.sessionId) }
        timeline = MediaTimeline(res)
        duration = res.duration
        audioTracks = res.audioTracks
        activeAudioIndex = res.selectedAudio?.index
        chapters = res.chapters
        nextEpisode = res.nextEpisode
        let keptSubtitle = newTitle ? nil : activeSubtitleId
        subtitleTracks = res.subtitleTracks
        if newTitle {
            subtitleCues = []
            activeSubtitleId = nil
            subtitleError = nil
        }

        #if os(tvOS)
        // The TV's mode switch takes seconds: ask for it as soon as the format is known.
        var criteriaTask: Task<Void, Never>?
        if newTitle || displayCriteria == nil, let format = newRemux?.videoFormat {
            setDisplayCriteria(DisplayMatch.criteria(for: format))
        }
        #endif

        if res.mode.isHLS {
            do {
                loadingStep = .preparingStream
                try await waitForPlaylist(res.url, gen: gen)
            } catch {
                newRemux?.stop()
                throw error
            }
        }
        guard isCurrent(gen, token) else { newRemux?.stop(); throw CancellationError() }
        let item = AVPlayerItem(url: url)
        item.preferredForwardBufferDuration = Self.forwardBuffer(res)
        #if os(tvOS)
        if newTitle || displayCriteria == nil, newRemux == nil {
            let asset = item.asset
            let direct = res.mode == .direct
            criteriaTask = Task { [weak self] in
                let criteria = await DisplayMatch.criteria(loading: asset, direct: direct)
                guard let self, gen == self.generation, token == self.startToken, let criteria else { return }
                self.setDisplayCriteria(criteria)
            }
        }
        #endif
        player.replaceCurrentItem(with: item)
        attachObservers(item)
        isBuffering = true
        remux = newRemux
        if newTitle || res.mode != .device { embeddedCues = [:]; embeddedCueKeys = [:] }
        if previousRemux !== newRemux { previousRemux?.stop() }

        do {
            loadingStep = .buffering
            try await waitUntilReady(item)
        } catch let error as StrataError where res.mode == .device {
            guard isCurrent(gen, token) else { throw CancellationError() }
            if !skipNativeSubtitles, newRemux?.subtitleRenditions.isEmpty == false {
                // Try once more without the subtitle tracks before giving up on the device.
                Log.player.warning("stream with subtitle tracks refused (\(error.message, privacy: .public)); trying without")
                skipNativeSubtitles = true
                return try await start(res, gen: gen, token: token, newTitle: newTitle, autoplay: autoplay)
            }
            // AVPlayer refused what the device made (a codec it can't decode, say).
            throw DeviceFailure(message: String(localized: "This file can't play on this device (\(error.message)). Pick another source.", bundle: .module))
        } catch let error as StrataError where newTitle {
            // Played from its link or the server's stream: the copy wouldn't open (its host
            // didn't answer, say). A failure like this is the copy's, so another may play.
            guard isCurrent(gen, token) else { throw CancellationError() }
            // Not the app's "can't reach your Strata server": it's the copy's own host.
            throw DeviceFailure(message: error.kind == .network && error.message.lowercased().contains("connect")
                ? String(localized: "This copy's server didn't answer. Choose another source.", bundle: .module)
                : String(localized: "This copy couldn't be opened (\(error.message)). Choose another source.", bundle: .module))
        }
        guard isCurrent(gen, token) else { throw CancellationError() }
        nativeSubtitles = res.mode == .device ? try? await item.asset.loadMediaSelectionGroup(for: .legible) : nil
        guard isCurrent(gen, token) else { throw CancellationError() }
        if let seek = MediaTimeline.initialSeek(res) {
            await player.seek(to: CMTime(seconds: seek, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        #if os(tvOS)
        // Started only once the TV is in its new mode, so the first seconds aren't lost to it.
        await criteriaTask?.value
        await waitForDisplaySwitch()
        #endif
        guard isCurrent(gen, token) else { throw CancellationError() }
        restartTarget = nil
        didStartPlayback = true
        position = timeline.mediaTime(streamTime: player.currentTime().seconds)
        status = .ready
        if autoplay {
            // play(), not playImmediately: the player fills a little buffer before it starts.
            activateAudioSession()
            wantsToPlay = true
            player.defaultRate = rate
            player.play()
            status = .playing
        } else {
            status = .paused
        }

        if newTitle {
            autoSelectForcedSubtitles()
        } else if let keptSubtitle, subtitleTracks.contains(where: { $0.id == keptSubtitle }) {
            // Cues are media time and the file is the same; keep them, just track the new URL.
            activeSubtitleId = keptSubtitle
        } else if keptSubtitle != nil {
            activeSubtitleId = nil
            subtitleCues = []
        }
        // The player only draws the stream's subtitles we turned on (not ones it picks by itself).
        applyNativeSubtitle()
        nowPlaying?.update(meta: meta, position: position, duration: duration, rate: player.rate)
        reportProgress(force: true)
    }

    /// How far ahead the player buffers. Long forward buffers waste server work on a remux.
    /// On the device the buffer sits in memory: a minute ahead rides out a slow patch in the
    /// network, but at 4K remux bitrates that's hundreds of MB, so it shrinks with the bitrate.
    private static func forwardBuffer(_ res: PlayResponse) -> TimeInterval {
        switch res.mode {
        case .remux, .transcode: return 30
        case .direct: return 0
        case .device:
            let mbps = res.duration > 0 ? Double(res.candidate.size) * 8 / res.duration / 1_000_000 : 0
            if mbps > 40 { return 15 }
            if mbps > 15 { return 30 }
            return 60
        }
    }

    #if os(tvOS)
    @ObservationIgnored private var displayCriteriaSetAt = Date.distantPast

    /// Asks the TV for the title's display mode, straight on the window's display manager
    /// (the player view sets it too, but only on its next render).
    private func setDisplayCriteria(_ criteria: AVDisplayCriteria?) {
        displayCriteria = criteria
        displayCriteriaSetAt = Date()
        PlayerLayerHostView.displayManager?.preferredDisplayCriteria = criteria
    }

    /// Waits while the TV switches its display mode (a few seconds of black screen).
    private func waitForDisplaySwitch() async {
        guard let manager = PlayerLayerHostView.displayManager, manager.isDisplayCriteriaMatchingEnabled else { return }
        // The switch begins a moment after the criteria are set.
        if !manager.isDisplayModeSwitchInProgress, Date().timeIntervalSince(displayCriteriaSetAt) < 0.3 {
            try? await Task.sleep(nanoseconds: 300_000_000)
        }
        let deadline = Date().addingTimeInterval(10)
        while manager.isDisplayModeSwitchInProgress, Date() < deadline, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }
    #endif

    /// Waits for the item to become playable, observing its status.
    private func waitUntilReady(_ item: AVPlayerItem, timeout: TimeInterval = 45) async throws {
        let waiter = ReadyWaiter()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                waiter.begin(continuation)
                waiter.observe(item.observe(\.status, options: [.initial, .new]) { [waiter] item, _ in
                    switch item.status {
                    case .readyToPlay: waiter.finish(.success(()))
                    case .failed: waiter.finish(.failure(StrataError(kind: .network, message: Self.describe(item.error))))
                    default: break
                    }
                })
                DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [waiter] in
                    waiter.finish(.failure(StrataError(kind: .network, message: String(localized: "The stream didn't start in time. Try again.", bundle: .module))))
                }
            }
        } onCancel: {
            waiter.finish(.failure(CancellationError()))
        }
    }

    // MARK: - Transport

    public func play() {
        guard player.currentItem != nil else { return }
        if status == .ended { Task { await seek(to: 0) } }
        activateAudioSession()
        wantsToPlay = true
        player.defaultRate = rate
        // Resuming from a pause: the buffer is already there, so start at once. Otherwise
        // let the player fill a little first.
        if status == .paused { player.playImmediately(atRate: rate) } else { player.play() }
        status = .playing
    }

    public func pause() {
        wantsToPlay = false
        player.pause()
        if player.currentItem != nil { status = .paused }
        reportProgress(force: true)
    }

    public func togglePlay() {
        switch status {
        case .playing: pause()
        case .paused, .ready, .ended: play()
        default: break
        }
    }

    public func skip(_ delta: TimeInterval) async {
        await seek(to: (restartTarget ?? position) + delta)
    }

    /// Seeks to a media time. Inside what the current stream can reach it's an ordinary
    /// seek; otherwise (HLS, outside the encoded range) the server restarts the stream
    /// there — rapid scrubs are coalesced.
    public func seek(to seconds: TimeInterval) async {
        guard session != nil, let item = player.currentItem else { return }
        let target = timeline.clamp(seconds)
        let seekable = item.seekableTimeRanges.map(\.timeRangeValue).compactMap { r -> ClosedRange<TimeInterval>? in
            let start = r.start.seconds, end = r.end.seconds
            guard start.isFinite, end.isFinite, end >= start else { return nil }
            return start...end
        }
        switch restartTarget == nil ? timeline.plan(seekTo: target, seekable: seekable) : .restart(media: target) {
        case .inPlace(let stream):
            restartTask?.cancel()
            position = target
            let tolerance = session?.mode == .direct ? .zero : CMTime(seconds: 0.5, preferredTimescale: 600)
            await player.seek(to: CMTime(seconds: stream, preferredTimescale: 600), toleranceBefore: tolerance, toleranceAfter: tolerance)
            if status == .ended { status = .paused }
            reportProgress(force: true)
        case .restart(let media):
            position = media
            restartTarget = media
            scheduleRestart(at: media, audioIndex: activeAudioIndex)
        }
    }

    /// Waits for the server's first HLS segment. A transcode can take longer than AVPlayer's
    /// ~20s playlist timeout to start (a 4K source, a slow disk or network share), and AVPlayer
    /// then fails the item as "resource unavailable"; it gets the URL once it answers.
    private func waitForPlaylist(_ url: URL, gen: Int) async throws {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        request.httpMethod = "GET"
        let deadline = Date().addingTimeInterval(150)
        while true {
            guard gen == generation else { throw CancellationError() }
            let status: Int
            do {
                let (_, response) = try await URLSession.shared.data(for: request)
                status = (response as? HTTPURLResponse)?.statusCode ?? 0
            } catch let error as URLError where error.code == .timedOut {
                status = 504
            }
            if (200..<300).contains(status) { return }
            // 504: not ready yet. Anything else (502 = ffmpeg failed): let AVPlayer report it.
            guard status == 504, Date() < deadline else { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
    }

    private func scheduleRestart(at media: TimeInterval, audioIndex: Int?, debounce: Bool = true) {
        restartTask?.cancel()
        startToken += 1
        let gen = generation
        let token = startToken
        let wasPlaying = status == .playing || status == .ended || status == .ready
        restartTask = Task { [weak self] in
            guard let self else { return }
            if debounce {
                try? await Task.sleep(nanoseconds: UInt64(self.restartDebounce * 1_000_000_000))
            }
            guard self.isCurrent(gen, token), let client = self.client, let target = self.target, let current = self.session else { return }
            self.player.pause()
            self.isBuffering = true
            do {
                let res = try await self.requestPlay(client: client, target: target, candidateId: current.candidate.id,
                                                     startMs: Int((media * 1000).rounded()), audioIndex: audioIndex, gen: gen)
                try await self.start(res, gen: gen, token: token, newTitle: false, autoplay: wasPlaying)
            } catch {
                guard self.isCurrent(gen, token), !(error is CancellationError) else { return }
                let e = StrataError.wrap(error)
                if e.kind != .cancelled {
                    self.restartTarget = nil
                    self.status = .failed((error as? DeviceFailure)?.message ?? e.message)
                }
            }
        }
    }

    public func toggleMute() {
        isMuted.toggle()
        player.isMuted = isMuted
    }

    /// Cycle through 1.0 → 1.25 → 1.5 → 2.0 → 1.0.
    public func cycleSpeed() {
        let cycle: [Float] = [1.0, 1.25, 1.5, 2.0]
        rate = cycle.first(where: { $0 > rate }) ?? 1.0
    }

    public func toggleVideoGravity() {
        videoGravity = (videoGravity == .resizeAspect) ? .resizeAspectFill : .resizeAspect
    }

    public func setVideoGravity(_ gravity: AVLayerVideoGravity) {
        guard gravity != videoGravity else { return }
        videoGravity = gravity
    }

    /// Arm (or, with `.off`, disarm) the sleep timer. Pauses playback when it fires.
    /// Survives moving to the next episode; cleared on `unload()`.
    public func setSleepTimer(_ option: SleepOption) {
        sleepTask?.cancel()
        sleepOption = option
        guard option != .off else {
            sleepTimerEnds = nil
            return
        }
        let minutes = option.rawValue
        sleepTimerEnds = Date().addingTimeInterval(TimeInterval(minutes * 60))
        sleepTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
            guard let self, !Task.isCancelled else { return }
            self.pause()
            self.sleepTimerEnds = nil
            self.sleepOption = .off
        }
    }

    // MARK: - Tracks

    /// Switches audio by restarting the stream at the current position with that track.
    public func selectAudio(_ track: AudioTrack) async {
        guard let current = session, track.index != activeAudioIndex else { return }
        if current.mode == .device {
            await switchDeviceAudio(to: track, in: current)
            return
        }
        activeAudioIndex = track.index
        let at = restartTarget ?? position
        restartTarget = at
        scheduleRestart(at: at, audioIndex: track.index, debounce: false)
        await restartTask?.value
    }

    /// Shows a subtitle track (nil turns subtitles off). Text tracks are fetched as WebVTT
    /// (the server may take a moment to extract embedded ones). In device mode, tracks
    /// inside the file (text and pictures) are read from it as it plays.
    public func selectSubtitle(_ track: SubtitleTrack?) async {
        subtitleTask?.cancel()
        subtitleError = nil
        defer { applyNativeSubtitle() }
        guard let track else {
            activeSubtitleId = nil
            subtitleCues = []
            isLoadingSubtitles = false
            return
        }
        if track.isEmbedded || track.isPicture, let index = track.streamIndex {
            activeSubtitleId = track.id
            isLoadingSubtitles = false
            // The player draws it from the stream; otherwise the overlay shows the lines read
            // from the file so far.
            subtitleCues = nativeOption(for: track) == nil ? embeddedCues[index] ?? [] : []
            return
        }
        guard let url = track.url else {
            subtitleError = String(localized: "\(track.displayTitle) is an image-based subtitle and can't be shown yet.", bundle: .module)
            return
        }
        guard let client else { return }
        activeSubtitleId = track.id
        subtitleCues = []
        isLoadingSubtitles = true
        let gen = generation
        let task = Task { [weak self] in
            do {
                let text = try await client.subtitles(url)
                // A film's worth of lines: parsed off the main actor.
                let cues = await Task.detached(priority: .userInitiated) {
                    WebVTT.parse(text).sorted { $0.start < $1.start }
                }.value
                guard let self, !Task.isCancelled, gen == self.generation, self.activeSubtitleId == track.id else { return }
                self.subtitleCues = cues
                self.isLoadingSubtitles = false
            } catch {
                guard let self, !Task.isCancelled, gen == self.generation, self.activeSubtitleId == track.id else { return }
                self.isLoadingSubtitles = false
                self.activeSubtitleId = nil
                self.subtitleError = StrataError.wrap(error).message
            }
        }
        subtitleTask = task
        await task.value
    }

    /// Forced subtitles in the audio's language turn on by themselves (foreign-dialogue tracks).
    private func autoSelectForcedSubtitles() {
        let audioLang = LanguageName.normalized(audioTracks.first { $0.index == activeAudioIndex }?.language)
        guard let forced = subtitleTracks.first(where: { t in
            t.forced && t.isShowable && (audioLang == nil || LanguageName.normalized(t.language) == audioLang)
        }) else { return }
        Task { await selectSubtitle(forced) }
    }

    // MARK: - Device mode

    /// The device couldn't open or play the file.
    private struct DeviceFailure: Error {
        let message: String
    }

    /// Audio the player takes as it is; anything else (DTS, TrueHD…) is decoded and kept lossless.
    private static let copyableAudio = Set(ClientCaps.current.audioCodecs)

    /// The stream's own track for an embedded subtitle, if the player found it.
    private func nativeOption(for track: SubtitleTrack) -> AVMediaSelectionOption? {
        guard let group = nativeSubtitles, let name = nativeSubtitleNames[track.id] else { return nil }
        return group.options.first { $0.displayName == name }
    }

    /// Has the player draw the active embedded track itself, or nothing.
    private func applyNativeSubtitle() {
        guard let group = nativeSubtitles, let item = player.currentItem else { return }
        item.select(activeSubtitle.flatMap(nativeOption(for:)), in: group)
    }

    private func makeRemux(_ res: PlayResponse) -> RemuxSession {
        let plan = res.remux
        let source: RemuxSession.Source
        if res.url.isFileURL {
            source = .file(res.url)
        } else {
            let client = client
            let sessionId = res.sessionId
            let refresh: (@Sendable () async throws -> URL)? = client.map { client in { try await client.refreshLink(sessionId: sessionId) } }
            source = .remote(res.url, refresh: refresh)
        }
        let hdr = res.candidate.hdr?.lowercased()
        let local = RemuxSession(source: source, plan: StrataRemux.RemuxPlan(
            videoStreamIndex: plan?.videoStreamIndex.map(Int32.init),
            audioStreamIndex: plan?.audioStreamIndex.map(Int32.init),
            audio: plan?.audio == "copy" || plan == nil ? .copy : .lossless,
            stripDolbyVision: plan?.stripDolbyVision ?? false,
            videoRange: hdr == "hlg" ? "HLG" : hdr == nil || hdr == "" ? "SDR" : "PQ"
        ))
        // Each embedded text track becomes a WebVTT track, named uniquely so it can be found.
        var names: [String: String] = [:]
        var renditions: [RemuxSession.SubtitleRendition] = []
        // A playlist that declares HDR is refused outright where HDR can't be shown (without
        // the declaration the player tone-maps it), so there the overlay draws the lines.
        let withTracks = !skipNativeSubtitles && (hdr == nil || hdr == "" || AVPlayer.eligibleForHDRPlayback)
        for track in res.subtitleTracks where track.isEmbedded && withTracks {
            var name = track.displayTitle
            var n = 2
            while names.values.contains(name) { name = "\(track.displayTitle) \(n)"; n += 1 }
            names[track.id] = name
            renditions.append(.init(streamIndex: Int32(track.streamIndex!), name: name, language: LanguageName.normalized(track.language),
                                    isDefault: false, forced: track.forced))
        }
        nativeSubtitleNames = names
        local.subtitleRenditions = renditions
        local.onCues = { [weak self, weak local] cues in
            Task { @MainActor [weak self] in
                guard let local else { return }
                self?.receive(cues, from: local)
            }
        }
        local.onServerLost = { [weak self, weak local] in
            Task { @MainActor [weak self] in
                guard let local else { return }
                self?.loopbackLost(local)
            }
        }
        return local
    }

    /// What makes an embedded line the same line when it's read again.
    private struct CueKey: Hashable {
        let start: TimeInterval
        /// -1 for a picture: its end can differ between reads, so pictures match by start.
        let end: TimeInterval
        let text: String
    }

    /// Keeps lines read from the file, and shows them when their track is on.
    private func receive(_ cues: [SubtitleCue], from source: RemuxSession) {
        guard source === remux else { return }
        var fresh: [Int: [VTTCue]] = [:]
        for cue in cues {
            let index = Int(cue.streamIndex)
            // A new session after an audio switch reads some of the same lines again.
            let key = CueKey(start: cue.start, end: cue.image == nil ? cue.end : -1, text: cue.text)
            guard embeddedCueKeys[index, default: []].insert(key).inserted else { continue }
            fresh[index, default: []].append(VTTCue(start: cue.start, end: cue.end, text: cue.text, image: cue.image))
        }
        for (index, lines) in fresh {
            embeddedCues[index] = Self.merge(embeddedCues[index] ?? [], lines.sorted { $0.start < $1.start })
        }
        if let active = activeSubtitle, active.isEmbedded || active.isPicture, let index = active.streamIndex, fresh[index] != nil,
           nativeOption(for: active) == nil {
            subtitleCues = embeddedCues[index] ?? []
        }
    }

    /// Two runs of cues sorted by start, as one. Lines mostly arrive in order, so usually
    /// this just appends.
    private static func merge(_ a: [VTTCue], _ b: [VTTCue]) -> [VTTCue] {
        guard let last = a.last, let first = b.first, first.start < last.start else { return a + b }
        var out: [VTTCue] = []
        out.reserveCapacity(a.count + b.count)
        var i = 0, j = 0
        while i < a.count, j < b.count {
            if b[j].start < a[i].start { out.append(b[j]); j += 1 } else { out.append(a[i]); i += 1 }
        }
        out.append(contentsOf: a[i...])
        out.append(contentsOf: b[j...])
        return out
    }

    // MARK: - What shows now

    /// Recomputes the cues showing at `position`, and publishes them only when they change.
    private func updateActiveCues() {
        let cues = subtitleCues
        var showing: [Int] = []
        if !cues.isEmpty {
            let t = position
            // The last cue starting at or before `t`, then back as far as a cue can last.
            var lo = 0, hi = cues.count
            while lo < hi {
                let mid = (lo + hi) / 2
                if cues[mid].start <= t { lo = mid + 1 } else { hi = mid }
            }
            var i = lo - 1
            while i >= 0, cues[i].start >= t - longestCue {
                if cues[i].end >= t { showing.append(i) }
                i -= 1
            }
            showing.reverse()
        }
        guard showing != activeCueIndices else { return }
        activeCueIndices = showing
        let text = showing.map { cues[$0].text }.filter { !$0.isEmpty }.joined(separator: "\n")
        let newText: String? = text.isEmpty ? nil : text
        if newText != activeCueText { activeCueText = newText }
        let images = showing.compactMap { cues[$0].image }
        if !(images.isEmpty && activeCueImages.isEmpty) { activeCueImages = images }
    }

    private func updateCurrentChapter() {
        let t = position
        let chapter = chapters.last { $0.start <= t }
        if chapter != currentChapter { currentChapter = chapter }
    }

    /// Switches audio by repackaging the same file with the other track, at the same spot.
    /// Nothing goes to the server.
    private func switchDeviceAudio(to track: AudioTrack, in current: PlayResponse) async {
        let at = position
        let wasPlaying = status == .playing || status == .ended || status == .ready
        var res = current
        res.remux?.audioStreamIndex = track.index
        res.remux?.audio = Self.copyableAudio.contains(track.codec.lowercased()) ? "copy" : "lossless"
        res.audioTracks = current.audioTracks.map { var t = $0; t.selected = t.index == track.index; return t }
        res.seekToMs = timeline.ms(at)
        activeAudioIndex = track.index
        await restartDevice(res, at: at, wasPlaying: wasPlaying).value
    }

    /// Repackages the file again from `at` (another audio track, a new address for AirPlay,
    /// a recovery). Nothing goes to the server. Supersedes any restart under way: it gets
    /// its own token, so an older one can never install its item after this one.
    @discardableResult
    private func restartDevice(_ res: PlayResponse, at: TimeInterval, wasPlaying: Bool) -> Task<Void, Never> {
        restartTask?.cancel()
        startToken += 1
        let gen = generation
        let token = startToken
        var res = res
        res.seekToMs = timeline.ms(at)
        player.pause()
        isBuffering = true
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.start(res, gen: gen, token: token, newTitle: false, autoplay: wasPlaying)
            } catch {
                guard self.isCurrent(gen, token), !(error is CancellationError) else { return }
                self.status = .failed((error as? DeviceFailure)?.message ?? StrataError.wrap(error).message)
            }
        }
        restartTask = task
        return task
    }

    #if os(iOS)
    /// AirPlay started or stopped. The Apple TV can't reach this device's 127.0.0.1, so in
    /// device mode the stream moves to the Wi-Fi address while it plays there, and back
    /// to loopback after.
    private func externalPlaybackChanged(_ active: Bool) {
        guard let current = session, current.mode == .device, restartTarget == nil,
              let url = (player.currentItem?.asset as? AVURLAsset)?.url else { return }
        let onLoopback = url.host == "127.0.0.1"
        guard active == onLoopback else { return }
        Log.player.info("AirPlay \(active ? "started" : "stopped", privacy: .public); moving the stream")
        restartDevice(current, at: position, wasPlaying: status == .playing || status == .ready)
    }
    #endif

    /// Device mode: a stall that lasts (a segment that never arrived, a player that gave up
    /// waiting) reopens the stream where it stopped instead of spinning forever.
    private func watchForStall() {
        guard session?.mode == .device, stallTask == nil, restartTarget == nil else { return }
        let gen = generation
        let item = player.currentItem
        let limit = stallLimit
        stallTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(limit * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            self.stallTask = nil
            guard gen == self.generation, self.player.currentItem === item,
                  self.player.timeControlStatus == .waitingToPlayAtSpecifiedRate else { return }
            self.recoverDevice("stalled for \(Int(limit))s", giveUp: String(localized: "Playback stalled and couldn't pick up again. Check the connection and try again, or pick another source.", bundle: .module))
        }
    }

    /// Reopens the device stream at the current position; after a few tries in a row, fails
    /// with `giveUp`.
    private func recoverDevice(_ reason: String, giveUp: String) {
        guard let current = session, current.mode == .device else { return }
        guard recoveries < Self.maxRecoveries else {
            Log.player.warning("device stream \(reason, privacy: .public); giving up")
            player.pause()
            isBuffering = false
            status = .failed(giveUp)
            return
        }
        recoveries += 1
        recoveredAt = position
        Log.player.warning("device stream \(reason, privacy: .public); reopening at \(self.position, privacy: .public)s")
        restartDevice(current, at: position, wasPlaying: true)
    }

    /// The loopback server stopped answering (it failed, or the system tore it down while
    /// the app was suspended): reopen the stream on a new one, where it was.
    private func loopbackLost(_ source: RemuxSession) {
        guard source === remux, let current = session, current.mode == .device, restartTarget == nil else { return }
        Log.player.warning("loopback server lost; reopening at \(self.position, privacy: .public)s")
        restartDevice(current, at: position, wasPlaying: status == .playing || status == .ready)
    }

    // MARK: - Unload

    /// Unloads only if nothing was loaded since `token` (`loadToken` when the caller's
    /// playback began): a view closing late must not stop a newer playback.
    public func unload(ifCurrent token: Int) async {
        guard token == loadToken else { return }
        await unload()
    }

    /// Stops playback: reports the final position, ends the server session, clears state.
    public func unload() async {
        sleepTask?.cancel()
        sleepTimerEnds = nil
        sleepOption = .off
        await teardown(reportFinal: true)
        generation += 1
        target = nil
        meta = nil
        #if os(tvOS)
        displayCriteria = nil
        #endif
        status = .idle
        nowPlaying?.update(meta: nil, position: 0, duration: 0, rate: 0)
        deactivateAudioSession()
    }

    private func teardown(reportFinal: Bool) async {
        startToken += 1
        loadTask?.cancel()
        loadTask = nil
        restartTask?.cancel()
        restartTask = nil
        subtitleTask?.cancel()
        subtitleTask = nil
        stallTask?.cancel()
        stallTask = nil
        if reportFinal { reportProgress(force: true) }
        wantsToPlay = false
        if let session { stopSession(session.sessionId) }
        removeObservers()
        player.pause()
        player.replaceCurrentItem(with: nil)
        remux?.stop()
        remux = nil
        embeddedCues = [:]
        embeddedCueKeys = [:]
        nativeSubtitles = nil
        nativeSubtitleNames = [:]
        session = nil
        timeline = MediaTimeline(startOffset: 0, duration: 0, isHLS: false)
        restartTarget = nil
        position = 0
        duration = 0
        isBuffering = false
        audioTracks = []
        subtitleTracks = []
        activeAudioIndex = nil
        activeSubtitleId = nil
        subtitleCues = []
        subtitleError = nil
        isLoadingSubtitles = false
        chapters = []
        nextEpisode = nil
        lastReportedMs = nil
        lastReportAt = .distantPast
        didStartPlayback = false
    }

    private func stopSession(_ id: String) {
        guard let client, !id.hasPrefix("offline-") else { return }
        Task.detached { try? await client.stopPlayback(sessionId: id) }
    }

    // MARK: - Progress

    /// A position on its way to the server.
    private struct Report {
        let client: StrataClient
        let target: PlaybackTarget
        let ms: Int
        let durationMs: Int
        let sessionId: String?
        let undelivered: (@Sendable (PlaybackTarget, Int, Int) -> Void)?
    }
    /// One report in flight at a time; behind it, only the latest for each title waits.
    @ObservationIgnored private var reportInFlight = false
    @ObservationIgnored private var pendingReports: [Report] = []
    @ObservationIgnored private var nowPlayingAt = Date.distantPast
    @ObservationIgnored private var nowPlayingRate: Float = -1

    private func reportProgress(force: Bool) {
        guard let target, let session, didStartPlayback else { return }
        let ms = timeline.ms(restartTarget ?? position)
        guard force || Date().timeIntervalSince(lastReportAt) >= progressInterval else { return }
        guard ms != lastReportedMs || force else { return }
        lastReportAt = Date()
        lastReportedMs = ms
        let durationMs = session.durationMs
        onProgress?(target, ms, durationMs)
        let undelivered = onUndeliveredProgress
        guard let client else { undelivered?(target, ms, durationMs); return }
        // A downloaded file has no session on the server.
        let sessionId = session.isOffline ? nil : session.sessionId
        let report = Report(client: client, target: target, ms: ms, durationMs: durationMs, sessionId: sessionId, undelivered: undelivered)
        // In order: a slow earlier report must never land after (and overwrite) a later one.
        // A newer position replaces one still waiting for the same title, so requests that
        // hang can't pile up; the last one (the final report) always goes once they end.
        if let last = pendingReports.last, last.target == report.target {
            pendingReports[pendingReports.count - 1] = report
        } else {
            pendingReports.append(report)
        }
        sendNextReport()
    }

    private func sendNextReport() {
        guard !reportInFlight, !pendingReports.isEmpty else { return }
        let report = pendingReports.removeFirst()
        reportInFlight = true
        Task { [weak self] in
            do {
                _ = try await report.client.reportProgress(report.target, positionMs: report.ms, durationMs: report.durationMs, sessionId: report.sessionId)
            } catch {
                Log.player.warning("progress report failed: \(StrataError.wrap(error).message, privacy: .public)")
                if StrataError.wrap(error).kind == .network { report.undelivered?(report.target, report.ms, report.durationMs) }
            }
            guard let self else { return }
            self.reportInFlight = false
            self.sendNextReport()
        }
    }

    // MARK: - System

    private func activateAudioSession() {
        #if os(iOS) || os(tvOS)
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            Log.player.warning("audio session didn't activate: \(error.localizedDescription, privacy: .public)")
        }
        #endif
    }

    /// Gives the audio back: music another app was playing can pick up again.
    private func deactivateAudioSession() {
        #if os(iOS) || os(tvOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    /// Audio interruptions (a call, an alarm), headphones unplugged, and the app coming back
    /// after a suspension (which can take the loopback server down).
    private func observeSystem() {
        let center = NotificationCenter.default
        #if os(iOS) || os(tvOS)
        let audio = AVAudioSession.sharedInstance()
        systemObservers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: audio, queue: .main) { [weak self] note in
            let info = note.userInfo ?? [:]
            let type = (info[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            let options = AVAudioSession.InterruptionOptions(rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            MainActor.assumeIsolated { self?.audioInterrupted(type, shouldResume: options.contains(.shouldResume)) }
        })
        systemObservers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: audio, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
            guard reason == .oldDeviceUnavailable else { return }
            // Headphones unplugged or out of range: don't carry on out loud.
            MainActor.assumeIsolated {
                guard let self, self.status == .playing else { return }
                self.pause()
            }
        })
        #endif
        #if canImport(UIKit)
        systemObservers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let remux = self.remux, !remux.isServing else { return }
                self.loopbackLost(remux)
            }
        })
        #endif
    }

    #if os(iOS) || os(tvOS)
    private func audioInterrupted(_ type: AVAudioSession.InterruptionType?, shouldResume: Bool) {
        switch type {
        case .began:
            playingBeforeInterruption = wantsToPlay && player.currentItem != nil
            if playingBeforeInterruption { pause() }
        case .ended:
            if shouldResume, playingBeforeInterruption, status == .paused { play() }
            playingBeforeInterruption = false
        default:
            break
        }
    }
    #endif

    // MARK: - Observers

    private func applyRate() {
        player.defaultRate = rate
        if status == .playing { player.rate = rate }
    }

    private func attachObservers(_ item: AVPlayerItem) {
        let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
        timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, self.restartTarget == nil, self.session != nil else { return }
                self.position = self.timeline.mediaTime(streamTime: time.seconds)
                // The system runs the lock-screen clock from the rate; a refresh every few
                // seconds (or on a rate change) is plenty, not four times a second.
                let rate = self.player.rate
                if rate != self.nowPlayingRate || Date().timeIntervalSince(self.nowPlayingAt) >= 5 {
                    self.nowPlayingRate = rate
                    self.nowPlayingAt = Date()
                    self.nowPlaying?.update(meta: self.meta, position: self.position, duration: self.duration, rate: rate)
                }
                if self.status == .playing { self.reportProgress(force: false) }
                if self.recoveries > 0, self.position - self.recoveredAt > 60 { self.recoveries = 0 }
            }
        }
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let failed = item.status == .failed
            let message = Self.describe(item.error)
            Task { @MainActor [weak self] in
                guard let self, failed, self.player.currentItem === item else { return }
                // Mid-play on the device (a read that failed for good, say): reopen where it
                // was. Before it first plays, `start` handles the failure itself.
                if self.session?.mode == .device, self.status == .playing || self.status == .paused, self.restartTarget == nil {
                    self.recoverDevice("failed: \(message)", giveUp: message)
                    return
                }
                self.status = .failed(message)
                self.isBuffering = false
            }
        }
        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            let tcs = p.timeControlStatus
            Task { @MainActor [weak self] in
                guard let self, self.session != nil else { return }
                self.isBuffering = tcs == .waitingToPlayAtSpecifiedRate || self.restartTarget != nil
                if tcs == .waitingToPlayAtSpecifiedRate { self.watchForStall() } else { self.stallTask?.cancel(); self.stallTask = nil }
                switch tcs {
                case .playing:
                    if self.restartTarget == nil { self.status = .playing }
                case .paused:
                    if self.status == .playing, self.restartTarget == nil {
                        self.status = .paused
                        self.reportProgress(force: true)
                    }
                default:
                    break
                }
            }
        }
        #if os(iOS)
        externalObservation = player.observe(\.isExternalPlaybackActive, options: [.new]) { [weak self] p, _ in
            let active = p.isExternalPlaybackActive
            Task { @MainActor [weak self] in self?.externalPlaybackChanged(active) }
        }
        #endif
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.restartTarget == nil else { return }
                self.status = .ended
                self.position = self.duration
                self.reportProgress(force: true)
            }
        }
    }

    private func removeObservers() {
        if let token = timeObserverToken {
            player.removeTimeObserver(token)
            timeObserverToken = nil
        }
        statusObservation = nil
        timeControlObservation = nil
        externalObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
    }

    nonisolated private static func describe(_ error: Error?) -> String {
        guard let error else { return String(localized: "Playback failed.", bundle: .module) }
        let ns = error as NSError
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSURLErrorDomain {
            return StrataError.wrap(URLError(URLError.Code(rawValue: underlying.code))).message
        }
        return ns.localizedFailureReason ?? ns.localizedDescription
    }
}

/// One wait for an item to become ready: finished once, by its status, a timeout or a cancel.
private final class ReadyWaiter: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    private var observation: NSKeyValueObservation?
    /// How it ended, when that came before `begin` (a cancel, or `.initial` KVO).
    private var early: Result<Void, Error>?
    private var done = false

    func begin(_ continuation: CheckedContinuation<Void, Error>) {
        lock.lock()
        if let early {
            lock.unlock()
            continuation.resume(with: early)
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    func observe(_ observation: NSKeyValueObservation) {
        lock.lock()
        if done {
            lock.unlock()
            observation.invalidate()
            return
        }
        self.observation = observation
        lock.unlock()
    }

    func finish(_ result: Result<Void, Error>) {
        lock.lock()
        guard !done else { lock.unlock(); return }
        done = true
        let continuation = self.continuation
        self.continuation = nil
        let observation = self.observation
        self.observation = nil
        if continuation == nil { early = result }
        lock.unlock()
        observation?.invalidate()
        continuation?.resume(with: result)
    }
}
