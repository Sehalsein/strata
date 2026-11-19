import Foundation
import AVFoundation
import Combine
import Observation
import AetherEngine
import StrataKit
#if canImport(UIKit)
import UIKit
#endif

/// What the player shows for the current title (Now Playing, chrome, Live Activity).
public struct PlaybackMeta: Sendable, Hashable {
    public var title: String
    /// e.g. the show name + "S1 · E2", or the year for a movie.
    public var subtitle: String?
    public var artworkURL: URL?
    /// The title's logo (the movie's or show's), shown in place of its name while it loads.
    public var logoURL: URL?

    public init(title: String, subtitle: String? = nil, artworkURL: URL? = nil, logoURL: URL? = nil) {
        self.title = title
        self.subtitle = subtitle
        self.artworkURL = artworkURL
        self.logoURL = logoURL
    }
}

/// Plays a Strata server session through AetherEngine.
///
/// The server says what to play and how (`PlayResponse`); AetherEngine plays it: a file's
/// link (TorBox, device mode), a file the server serves (direct), the server's own HLS
/// (remux/transcode), or a download on the device. This class keeps what's Strata's own:
/// asking the server, trying another copy when one won't play, fresh links for expired ones,
/// progress, the admins' reports, subtitles from the server, and the server's restarts.
///
/// Every time exposed here (`position`, `duration`, `seek(to:)`, chapters, subtitle cues) is
/// **media time** — seconds into the title — regardless of where the server's HLS stream starts.
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
    /// Full title duration from the server (HLS EVENT playlists grow, so the stream's own duration isn't used).
    public private(set) var duration: TimeInterval = 0
    /// Waiting for data (initial load, stall, or a seek restart).
    public private(set) var isBuffering = false
    public private(set) var isMuted = false
    public var rate: Float = 1.0 { didSet { aether.setRate(rate) } }

    public private(set) var target: PlaybackTarget?
    public private(set) var meta: PlaybackMeta?
    /// The current server session: mode, candidate (source file), reasons, URLs.
    public private(set) var session: PlayResponse?

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
    /// Parsed cues of a track fetched from the server, in media time, sorted by start.
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
    public private(set) var activeCueImages: [SubtitlePicture] = []
    /// Which server cues are showing (indices into `subtitleCues`), to tell when that changes.
    @ObservationIgnored private var activeCueIndices: [Int]?
    /// The longest cue: how far back from a time a cue can start and still show then.
    @ObservationIgnored private var longestCue: TimeInterval = 0
    /// Where the showing subtitles come from: the server (a WebVTT file), or the file itself
    /// (AetherEngine reads embedded tracks, text and pictures, as it plays).
    private enum CueSource { case none, server, engine }
    @ObservationIgnored private var cueSource: CueSource = .none
    /// The video's frame size, which picture subtitles are placed against.
    public private(set) var videoSize: CGSize?

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
    /// Setting it (the Fit/Fill button, double-tap, pinch) also leaves any aspect ratio crop.
    public var videoGravity: AVLayerVideoGravity {
        didSet {
            aspectRatio = nil
            aether.videoGravity = effectiveVideoGravity
            UserDefaults.standard.set(videoGravity.rawValue, forKey: Self.videoGravityKey)
        }
    }
    private static let videoGravityKey = "strata.videoGravity"

    /// A shape to crop the picture to, fitted on screen: 2.39 takes the bars off a scope film
    /// encoded 16:9, 4:3 shows an Academy picture without stretching. For this title only,
    /// since films differ (cleared when the next one loads).
    public private(set) var aspectRatio: AspectRatio? {
        didSet { aether.videoGravity = effectiveVideoGravity }
    }

    /// What the layer does with the picture: a crop fills its box, which has the crop's shape.
    public var effectiveVideoGravity: AVLayerVideoGravity { aspectRatio != nil ? .resizeAspectFill : videoGravity }

    /// Default (fit), Zoomed (fill) or a crop, as the player's aspect menu offers them.
    public var pictureMode: PictureMode {
        get {
            if let aspectRatio { return .crop(aspectRatio) }
            return videoGravity == .resizeAspectFill ? .zoomed : .default
        }
        set {
            switch newValue {
            case .default: videoGravity = .resizeAspect
            case .zoomed: videoGravity = .resizeAspectFill
            case .crop(let ratio): aspectRatio = ratio
            }
        }
    }

    /// Where the video's box sits in a view of `size`: all of it, or the largest rectangle of
    /// the crop's shape, centred.
    public func videoBox(in size: CGSize) -> CGRect {
        guard let r = aspectRatio?.ratio, size.width > 0, size.height > 0 else { return CGRect(origin: .zero, size: size) }
        let w = min(size.width, size.height * r), h = w / r
        return CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h)
    }

    /// The playback engine underneath; the player view draws it (`AetherPlayerSurface`).
    public let aether: AetherEngine
    /// The video layer on the native route, for Picture in Picture; nil on the software route.
    public var nativePlayerLayer: AVPlayerLayer? { aether.nativePlayerLayer }

    public private(set) var client: StrataClient?
    private var nowPlaying: NowPlayingBridge?

    // Session plumbing
    private var timeline = MediaTimeline(startOffset: 0, duration: 0, isHLS: false)
    private var loadTask: Task<Void, Never>?
    private var restartTask: Task<Void, Never>?
    private var subtitleTask: Task<Void, Never>?
    /// Bumped on every new load/unload; stale async work checks it before touching state.
    private var generation = 0
    /// Bumped by every load and restart: only the newest may install its session.
    @ObservationIgnored private var startToken = 0
    /// Bumped as soon as `load` is called; see `unload(ifCurrent:)`.
    public private(set) var loadToken = 0
    /// Playing when an audio interruption (a call, an alarm) began.
    @ObservationIgnored private var playingBeforeInterruption = false
    /// Playback was asked to run (and not paused since), whatever the engine is doing now.
    @ObservationIgnored private var wantsToPlay = false
    @ObservationIgnored private var systemObservers: [NSObjectProtocol] = []
    @ObservationIgnored private var cancellables: Set<AnyCancellable> = []
    /// A start is opening its stream: the engine's state belongs to it until it returns.
    @ObservationIgnored private var starting = false
    /// Media time being restarted to; the timeline isn't trusted until the new stream plays.
    private var restartTarget: TimeInterval?
    /// Files whose media info this load already read for the server (see `probe`).
    private var probedFiles = Set<Int>()
    /// The file last read for the server (`probe`), so a failed read can rule it out.
    private var lastProbedFile: Int?
    /// Other copies tried after the first one failed on this device, at most.
    private static let maxFallbacks = 3
    /// This load's copies that went wrong, for the household's admins (`sendReport`).
    @ObservationIgnored private var reportAttempts: [PlayReport.Attempt] = []
    /// Fresh links asked for this title because the last one stopped working mid-play, or its
    /// server was too slow to keep up (a fresh link can point at another of TorBox's servers).
    private var linkRefreshes = 0
    private static let maxLinkRefreshes = 3
    /// Waits out a stall, then gets the file from a fresh link (see `watchForStall`).
    @ObservationIgnored private var stallTask: Task<Void, Never>?
    @ObservationIgnored private var lastReportAt = Date.distantPast
    @ObservationIgnored private var lastReportedMs: Int?
    /// Set once the first stream played; before that there's no real position to report
    /// (reporting 0 would wipe the saved resume point).
    private var didStartPlayback = false

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
    /// How long a stream may take to show its first frame.
    public var startTimeout: TimeInterval = 45
    /// How long playback may sit buffering before a file's link is swapped for a fresh one.
    public var stallLimit: TimeInterval = 12
    /// At most this many connections to a file's server at once. TorBox allows four per
    /// link and blocks an address that sends many small requests, so this stays low.
    public static let maxSourceConnections = 2

    public init() {
        do {
            aether = try AetherEngine()
        } catch {
            fatalError("AetherEngine couldn't start: \(error)")
        }
        if let raw = UserDefaults.standard.string(forKey: Self.videoGravityKey) {
            videoGravity = AVLayerVideoGravity(rawValue: raw)
        } else {
            videoGravity = .resizeAspect
        }
        aether.videoGravity = effectiveVideoGravity
        aether.backgroundPlaybackEnabled = true
        aether.deactivatesAudioSessionOnStop = true
        observeEngine()
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
        probedFiles = []
        lastProbedFile = nil
        linkRefreshes = 0
        reportAttempts = []
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
                Log.player.warning("play failed: \(failure.message, privacy: .public)")
                self.fallbackNote = nil
                self.status = .failed(failure.message)
                self.sendReport(.failed, message: failure.message)
            } catch {
                guard gen == self.generation, !(error is CancellationError) else { return }
                let e = StrataError.wrap(error)
                self.fallbackNote = nil
                if e.kind != .cancelled {
                    self.status = .failed(e.message)
                    // The Strata server's own refusal ("no copy of this yet"…); one we couldn't
                    // reach can't hear about it either.
                    if e.kind != .network {
                        self.reportAttempts.append(PlayReport.Attempt(stage: "asking the server", error: e.message))
                        self.sendReport(.failed, message: e.message)
                    }
                }
            }
        }
        loadTask = task
        await task.value
    }

    /// Plays a downloaded file (`res` from `DownloadItem.playResponse`) without the server.
    public func load(offline res: PlayResponse, target: PlaybackTarget, meta: PlaybackMeta) async {
        loadToken += 1
        await teardown(reportFinal: true)
        generation += 1
        let gen = generation
        startToken += 1
        let token = startToken
        linkRefreshes = 0
        self.target = target
        self.meta = meta
        status = .loading
        position = TimeInterval(res.seekToMs) / 1000
        nowPlaying?.update(meta: meta, position: position, duration: duration, rate: 0)
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                // A download plays as it is: never the server's HLS (which only a server serves).
                guard res.mode == .direct || res.mode == .device else {
                    throw DeviceFailure(message: String(localized: "This download can't play on this device. Download it again.", bundle: .module))
                }
                // Built on this device from a download: the one start that may open a local file.
                try await self.start(res, gen: gen, token: token, newTitle: true, autoplay: true, local: true)
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

    /// Plays `candidateId`, or the server's choice (which is the copy you played before, on
    /// any device, when the server remembers one). When that won't open on this device (its
    /// link doesn't connect, the file can't be read or decoded here), the next copy the server
    /// lists that's ready to play is tried, up to `maxFallbacks` of them; the one that plays is
    /// remembered on the server for next time. A copy you picked yourself isn't swapped: its
    /// failure is shown, with Choose Source.
    private func loadWithFallback(client: StrataClient, target: PlaybackTarget, candidateId: String?, startMs: Int?, gen: Int, token: Int) async throws {
        var pick = candidateId
        var failedCandidates = Set<String>()
        var failedFiles = Set<Int>()
        var others: [Candidate]?
        var attempt = 0
        while true {
            try Task.checkCancellation()
            var res: PlayResponse?
            do {
                res = try await requestPlay(client: client, target: target, candidateId: pick, startMs: startMs, audioIndex: nil, gen: gen)
                try await start(res!, gen: gen, token: token, newTitle: true, autoplay: true)
                fallbackNote = nil
                loadingStep = nil
                if !reportAttempts.isEmpty {
                    reportAttempts.append(PlayReport.Attempt(fileId: res!.candidate.fileId, copy: Self.copyLabel(res!.candidate)))
                    sendReport(.recovered, message: "Played copy \(reportAttempts.count) after \(reportAttempts.count - 1) didn't.")
                }
                // Your pick, or a copy that played after others didn't: start with it next time,
                // on every device.
                if candidateId != nil || attempt > 0 { remember(res!.candidate.id, for: target, client: client) }
                return
            } catch let failure as DeviceFailure {
                guard gen == generation else { throw CancellationError() }
                reportAttempts.append(PlayReport.Attempt(
                    fileId: res?.candidate.fileId ?? lastProbedFile,
                    copy: res.map { Self.copyLabel($0.candidate) },
                    stage: failure.stage,
                    error: failure.detail ?? failure.message,
                    servers: failure.servers))
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
                // The copy the server went back to for you didn't play: it stops going back.
                if res?.remembered == true { remember(nil, for: target, client: client) }
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

    /// What the player says while it switches: why the last copy was passed over, and
    /// which one it's trying ("That copy couldn't be reached. Switching to 1080p · WEB (2 of 4)…").
    private static func fallbackNote(after failure: DeviceFailure, next: Candidate, attempt: Int) -> String {
        let why = switch failure.reason {
        case .unreachable: String(localized: "That copy couldn't be reached.", bundle: .module)
        case .unplayable: String(localized: "That copy won't play on this device.", bundle: .module)
        case .other: String(localized: "That copy wouldn't open.", bundle: .module)
        }
        let label = [next.resolutionLabel, next.source?.uppercased()].compactMap { $0 }.joined(separator: " · ")
        let what = label.isEmpty ? String(localized: "another source", bundle: .module) : label
        return String(localized: "\(why) Switching to \(what) (try \(attempt + 1) of \(maxFallbacks + 1))…", bundle: .module)
    }

    /// Tells the server which copy played (or, nil, to stop going back to it). In the
    /// background: Play must not wait on it, and a server too old to remember ignores it.
    private func remember(_ candidateId: String?, for target: PlaybackTarget, client: StrataClient) {
        Task.detached(priority: .utility) {
            do {
                try await client.setPick(target, candidateId: candidateId)
            } catch {
                Log.player.warning("couldn't save the copy played: \(StrataError.wrap(error).message, privacy: .public)")
            }
        }
    }

    /// Plays the next episode (from `nextEpisode`), from the start.
    public func playNext(meta: PlaybackMeta? = nil) async {
        guard let next = nextEpisode, let nextTarget else { return }
        let m = meta ?? PlaybackMeta(title: next.name, subtitle: next.code, artworkURL: next.stillUrl ?? self.meta?.artworkURL, logoURL: self.meta?.logoURL)
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
            throw DeviceFailure(message: String(localized: "The server couldn't use what this file holds. Pick another source.", bundle: .module), stage: "reading")
        }
        guard Self.isOpenable(url, local: false) else {
            throw DeviceFailure(message: String(localized: "This file's link isn't one the app can open. Pick another source.", bundle: .module), stage: "reading")
        }
        status = .loading
        let info: MediaInfo
        do {
            loadingStep = .reading
            info = try await MediaProbe.probe(url: url)
        } catch {
            guard gen == generation, !(error is CancellationError) else { throw CancellationError() }
            let why = Self.redact(error.localizedDescription)
            Log.player.warning("probe failed: \(why, privacy: .public)")
            throw DeviceFailure(message: String(localized: "This file couldn't be read (\(why)). Pick another source.", bundle: .module),
                                stage: "reading", detail: Self.describeRaw(error), reason: .unreachable,
                                servers: url.host.map { [PlayReport.Server(host: $0, error: why)] } ?? [])
        }
        guard gen == generation else { throw CancellationError() }
        try await client.reportProbe(fileId: fileId, info: info)
        guard gen == generation else { throw CancellationError() }
    }

    /// Whether a start (`gen`, `token`) is still the one wanted: a newer load or restart
    /// supersedes it, and it must never install its stream.
    private func isCurrent(_ gen: Int, _ token: Int) -> Bool {
        gen == generation && token == startToken && !Task.isCancelled
    }

    /// Plays a play response. `newTitle` resets tracks/subtitles; otherwise (a restart for a
    /// seek, an audio switch, a fresh link) the subtitle selection and cues carry over.
    /// `local`: `res` was built on this device (a download), not sent by the server. Only
    /// then may a file on the device be opened; every other start passes false.
    private func start(_ res: PlayResponse, gen: Int, token: Int, newTitle: Bool, autoplay: Bool, local: Bool = false) async throws {
        // A server session this start opened but never installed is stopped, however it ends.
        var installed = false
        defer { if !installed, res.sessionId != session?.sessionId { stopSession(res.sessionId) } }
        guard isCurrent(gen, token) else { throw CancellationError() }
        starting = true
        defer { starting = false }

        // Only web links from the server; files on the device only for a download, whose
        // response the app built itself.
        guard Self.isOpenable(res.url, local: local) else {
            throw DeviceFailure(message: String(localized: "This copy's link isn't one the app can open. Choose another source.", bundle: .module), stage: "connecting")
        }
        if res.mode.isHLS {
            loadingStep = .preparingStream
            try await waitForPlaylist(res.url, gen: gen)
        }
        guard isCurrent(gen, token) else { throw CancellationError() }

        let previous = session
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
        let keptSubtitle = newTitle ? nil : activeSubtitle
        subtitleTracks = res.subtitleTracks
        if newTitle {
            subtitleCues = []
            activeSubtitleId = nil
            cueSource = .none
            subtitleError = nil
            clearActiveCues()
        }

        // The file itself (a link, the server's file, a download): AetherEngine reads it,
        // from the resume point and with the chosen audio. The server's HLS starts where the
        // server cut it, and is moved to the resume point after.
        let readsFile = !res.mode.isHLS
        var options = LoadOptions()
        options.autoplay = autoplay
        // The scrubber shows no thumbnails: no side reads all over the file to make them.
        options.generatesBackgroundScrubPreviews = false
        if readsFile { options.maxConcurrentSourceRequests = Self.maxSourceConnections }
        let startAt: Double? = readsFile && res.seekToMs > 0 ? TimeInterval(res.seekToMs) / 1000 : nil
        let audioIndex: Int32? = readsFile ? res.selectedAudio.map { Int32($0.index) } : nil
        loadingStep = readsFile ? .connecting : .buffering
        isBuffering = true
        do {
            _ = try await aether.load(url: res.url, startPosition: startAt, options: options, audioSourceStreamIndex: audioIndex)
            guard isCurrent(gen, token) else { throw CancellationError() }
            loadingStep = .buffering
            try await waitUntilStarted(gen: gen, token: token)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            guard isCurrent(gen, token) else { throw CancellationError() }
            aether.stop()
            isBuffering = false
            throw Self.failure(error, info: aether.errorInfo, res: res)
        }
        guard isCurrent(gen, token) else { throw CancellationError() }
        if !readsFile, let seek = MediaTimeline.initialSeek(res) {
            await aether.seek(to: seek)
        }
        guard isCurrent(gen, token) else { throw CancellationError() }
        if rate != 1 { aether.setRate(rate) }
        aether.volume = isMuted ? 0 : 1
        restartTarget = nil
        didStartPlayback = true
        isBuffering = false
        position = timeline.mediaTime(streamTime: aether.clock.currentTime)
        if chapters.isEmpty {
            chapters = aether.mediaChapters.map { Chapter(startMs: Int(($0.startSeconds * 1000).rounded()), title: $0.name.isEmpty ? nil : $0.name) }
        }
        wantsToPlay = autoplay
        status = autoplay ? .playing : .paused

        if newTitle {
            // The server decides which track starts on; the player just turns it on.
            if let id = res.selectedSubtitleId, let track = subtitleTracks.first(where: { $0.id == id }) {
                Task { await selectSubtitle(track) }
            }
        } else if let keptSubtitle, subtitleTracks.contains(where: { $0.id == keptSubtitle.id }) {
            // Server cues are media time and the file is the same: keep them. A track the
            // engine reads from the file is turned on again in the new stream.
            if cueSource == .engine, let index = keptSubtitle.streamIndex { aether.selectSubtitleTrack(index: index) }
        } else if keptSubtitle != nil {
            activeSubtitleId = nil
            cueSource = .none
            subtitleCues = []
            clearActiveCues()
        }
        nowPlaying?.update(meta: meta, position: position, duration: duration, rate: autoplay ? rate : 0)
        reportProgress(force: true)
    }

    /// Waits for the stream's first frame (or for it to be ready, paused), or its failure.
    private func waitUntilStarted(gen: Int, token: Int) async throws {
        let deadline = Date().addingTimeInterval(startTimeout)
        while true {
            guard isCurrent(gen, token) else { throw CancellationError() }
            switch aether.playbackPhase {
            case .playing, .paused, .ended:
                return
            case .error(let message):
                throw StrataError(kind: .network, message: Self.redact(message))
            default:
                if aether.hasFirstFrameReadyForDisplay { return }
            }
            if Date() > deadline {
                throw StrataError(kind: .network, message: String(localized: "The stream didn't start in time. Try again.", bundle: .module))
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    // MARK: - Transport

    public func play() {
        guard session != nil else { return }
        if status == .ended { Task { await seek(to: 0) } }
        activateAudioSession()
        wantsToPlay = true
        aether.play()
        status = .playing
    }

    public func pause() {
        wantsToPlay = false
        aether.pause()
        if session != nil { status = .paused }
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

    /// Seeks to a media time. A file is seeked in place. The server's HLS is seeked in place
    /// inside what the stream reaches; otherwise the server restarts the stream there (rapid
    /// scrubs are coalesced).
    public func seek(to seconds: TimeInterval) async {
        guard let current = session, didStartPlayback else { return }
        let target = timeline.clamp(seconds)
        guard current.mode.isHLS else {
            restartTask?.cancel()
            position = target
            await aether.seek(to: target)
            if status == .ended { status = .paused }
            reportProgress(force: true)
            return
        }
        let reach = max(aether.duration, aether.clock.bufferedPosition, aether.clock.currentTime)
        let seekable: [ClosedRange<TimeInterval>] = reach > 0 ? [0...reach] : []
        switch restartTarget == nil ? timeline.plan(seekTo: target, seekable: seekable) : .restart(media: target) {
        case .inPlace(let stream):
            restartTask?.cancel()
            position = target
            await aether.seek(to: stream)
            if status == .ended { status = .paused }
            reportProgress(force: true)
        case .restart(let media):
            position = media
            restartTarget = media
            scheduleRestart(at: media, audioIndex: activeAudioIndex)
        }
    }

    /// Waits for the server's first HLS segment. A transcode can take longer than the
    /// player's playlist timeout to start (a 4K source, a slow disk or network share).
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
            // 504: not ready yet. Anything else (502 = ffmpeg failed): let the player report it.
            guard status == 504, Date() < deadline else { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
    }

    /// Asks the server for the stream again from `media` (an HLS seek past what it reaches,
    /// or another audio track), and plays it in place of the current one.
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
            self.aether.pause()
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

    /// Opens the same file again from `at`, with `res`'s link (a fresh one, after the last
    /// expired). Nothing changes on the server. Supersedes any restart under way.
    @discardableResult
    private func reopen(_ res: PlayResponse, at: TimeInterval, wasPlaying: Bool) -> Task<Void, Never> {
        restartTask?.cancel()
        stopStallWatch()
        startToken += 1
        let gen = generation
        let token = startToken
        var res = res
        res.seekToMs = timeline.ms(at)
        restartTarget = at
        isBuffering = true
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.start(res, gen: gen, token: token, newTitle: false, autoplay: wasPlaying)
            } catch {
                guard self.isCurrent(gen, token), !(error is CancellationError) else { return }
                self.restartTarget = nil
                self.status = .failed((error as? DeviceFailure)?.message ?? StrataError.wrap(error).message)
            }
        }
        restartTask = task
        return task
    }

    public func toggleMute() {
        isMuted.toggle()
        aether.volume = isMuted ? 0 : 1
    }

    /// Cycle through 1.0 → 1.25 → 1.5 → 2.0 → 1.0.
    public func cycleSpeed() {
        let cycle: [Float] = [1.0, 1.25, 1.5, 2.0]
        rate = cycle.first(where: { $0 > rate }) ?? 1.0
    }

    /// Fit ↔ fill; from a crop, back to fit.
    public func toggleVideoGravity() {
        videoGravity = (videoGravity == .resizeAspect && aspectRatio == nil) ? .resizeAspectFill : .resizeAspect
    }

    public func setVideoGravity(_ gravity: AVLayerVideoGravity) {
        guard gravity != videoGravity else { return }
        videoGravity = gravity
    }

    /// Tells the engine Picture in Picture started or stopped: it keeps the video running
    /// in the background while the window shows.
    public func setPictureInPictureActive(_ active: Bool) {
        aether.pictureInPictureActive = active
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

    /// Switches audio: the engine changes track in the file it reads; the server's HLS is
    /// restarted at the current position with that track.
    public func selectAudio(_ track: AudioTrack) async {
        guard let current = session, track.index != activeAudioIndex else { return }
        activeAudioIndex = track.index
        guard current.mode.isHLS else {
            aether.selectAudioTrack(index: track.index)
            return
        }
        let at = restartTarget ?? position
        restartTarget = at
        scheduleRestart(at: at, audioIndex: track.index, debounce: false)
        await restartTask?.value
    }

    /// Shows a subtitle track (nil turns subtitles off). Tracks inside the file (text and
    /// pictures) are read by the engine as it plays; the server's text tracks are fetched as
    /// WebVTT (the server may take a moment to extract embedded ones).
    public func selectSubtitle(_ track: SubtitleTrack?) async {
        subtitleTask?.cancel()
        subtitleError = nil
        guard let track else {
            activeSubtitleId = nil
            cueSource = .none
            subtitleCues = []
            isLoadingSubtitles = false
            aether.clearSubtitle()
            clearActiveCues()
            return
        }
        if let current = session, !current.mode.isHLS, track.isEmbedded || track.isPicture, let index = track.streamIndex {
            activeSubtitleId = track.id
            cueSource = .engine
            subtitleCues = []
            isLoadingSubtitles = false
            clearActiveCues()
            aether.selectSubtitleTrack(index: index)
            return
        }
        guard let url = track.url else {
            subtitleError = String(localized: "\(track.displayTitle) is an image-based subtitle and can't be shown yet.", bundle: .module)
            return
        }
        guard let client else { return }
        aether.clearSubtitle()
        activeSubtitleId = track.id
        cueSource = .server
        subtitleCues = []
        clearActiveCues()
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
                self.cueSource = .none
                self.subtitleError = StrataError.wrap(error).message
            }
        }
        subtitleTask = task
        await task.value
    }

    // MARK: - What shows now

    private func clearActiveCues() {
        activeCueIndices = nil
        if activeCueText != nil { activeCueText = nil }
        if !activeCueImages.isEmpty { activeCueImages = [] }
    }

    /// The server's cues showing at `position`, published only when they change.
    private func updateActiveCues() {
        guard cueSource == .server else { return }
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
        if !activeCueImages.isEmpty { activeCueImages = [] }
    }

    /// The engine's cues (a track inside the file) showing now. They're stamped in the
    /// file's own time, so they're matched against the engine's source time.
    private func updateEngineCues() {
        guard cueSource == .engine else { return }
        let t = aether.clock.sourceTime
        let showing = aether.subtitleCues.filter { $0.startTime <= t && t <= $0.endTime }
        let text = showing.compactMap(\.text).filter { !$0.isEmpty }.joined(separator: "\n")
        let newText: String? = text.isEmpty ? nil : text
        if newText != activeCueText { activeCueText = newText }
        let pictures: [SubtitlePicture] = showing.compactMap { cue in
            guard case .image(let image) = cue.body else { return nil }
            return SubtitlePicture(image: image.cgImage, rect: placement(of: image))
        }
        if pictures != activeCueImages { activeCueImages = pictures }
    }

    /// Where a picture subtitle sits on the video, 0…1. Its position is against the disc's
    /// canvas, which is laid on the video width-aligned and centred (a cropped rip's canvas
    /// is taller than its video).
    private func placement(of image: SubtitleImage) -> CGRect {
        let p = image.position
        guard let video = videoSize, video.width > 0, video.height > 0,
              image.canvasSize.width > 0, image.canvasSize.height > 0 else { return p }
        let canvasHeight = image.canvasSize.height * video.width / image.canvasSize.width
        let top = (video.height - canvasHeight) / 2
        return CGRect(x: p.minX, y: (top + p.minY * canvasHeight) / video.height,
                      width: p.width, height: p.height * canvasHeight / video.height)
    }

    private func updateCurrentChapter() {
        let t = position
        let chapter = chapters.last { $0.start <= t }
        if chapter != currentChapter { currentChapter = chapter }
    }

    // MARK: - Failures

    /// A stream that wouldn't play: why, for the person, the fallback and the admins.
    private struct DeviceFailure: Error {
        enum Reason { case unreachable, unplayable, other }
        let message: String
        /// For the admins' report: where it went wrong, and the error as it came.
        var stage: String?
        var detail: String?
        var reason: Reason = .other
        var servers: [PlayReport.Server] = []
    }

    /// What a failed start means, from the engine's typed reason.
    private static func failure(_ error: Error, info: PlaybackErrorInfo?, res: PlayResponse) -> DeviceFailure {
        let host = res.url.host
        // Engine messages can quote a link, and TorBox links carry the account's key.
        let said = redact(info?.message ?? error.localizedDescription)
        let detail = [host, info.map { "\($0.kind.rawValue): \(redact($0.message))" } ?? describeRaw(error)].compactMap { $0 }.joined(separator: ": ")
        let server = { (why: String) in host.map { [PlayReport.Server(host: $0, error: why)] } ?? [] }
        switch info?.kind {
        case .sourceRateLimited?:
            return DeviceFailure(message: String(localized: "This copy's server is limiting requests right now. Choose another source.", bundle: .module),
                                 stage: "connecting", detail: detail, reason: .unreachable, servers: server("rate limited"))
        case .sourceRefused?:
            let status = info?.underlyingCode.map { " (\($0))" } ?? ""
            return DeviceFailure(message: String(localized: "This copy's server refused it\(status). Choose another source.", bundle: .module),
                                 stage: "connecting", detail: detail, reason: .unreachable, servers: server("refused\(status)"))
        case .sourceOpenFailed?:
            if info?.underlyingDomain == NSURLErrorDomain {
                return DeviceFailure(message: String(localized: "This copy's server didn't answer. Choose another source.", bundle: .module),
                                     stage: "connecting", detail: detail, reason: .unreachable, servers: server(said))
            }
            return DeviceFailure(message: String(localized: "This copy couldn't be opened (\(said)). Choose another source.", bundle: .module),
                                 stage: "connecting", detail: detail)
        default:
            return DeviceFailure(message: String(localized: "This file can't play on this device (\(said)). Pick another source.", bundle: .module),
                                 stage: "starting", detail: detail, reason: .unplayable)
        }
    }

    /// The engine failed mid-play. A link that expired (TorBox links last a few hours) gets
    /// a fresh one, played from where it stopped; anything else ends the play.
    private func failedWhilePlaying(_ message: String) {
        guard session != nil, didStartPlayback, restartTarget == nil else { return }
        let info = aether.errorInfo
        let expired = info?.kind == .sourceRefused && [401, 403, 404, 410].contains(info?.underlyingCode ?? 0)
        if expired, reopenWithFreshLink(because: "link refused (\(info?.underlyingCode ?? 0))", giveUp: message) { return }
        endPlay(message)
    }

    /// Playback has been stuck buffering a while: the file's server isn't keeping up (TorBox
    /// throttles an address it has just unblocked, for one). A fresh link often points at
    /// another server; after a few, the play ends and says so instead of spinning on.
    private func watchForStall() {
        guard stallTask == nil, let current = session, current.mode == .device, !current.isOffline,
              didStartPlayback, restartTarget == nil else { return }
        let gen = generation
        let limit = stallLimit
        stallTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(limit * 1_000_000_000))
            guard let self, !Task.isCancelled, gen == self.generation else { return }
            self.stallTask = nil
            switch self.aether.playbackPhase {
            case .loading, .seeking, .rebuffering, .stalled: break
            default: return
            }
            guard self.wantsToPlay, self.restartTarget == nil else { return }
            let giveUp = String(localized: "This copy's server is too slow right now. Choose another source.", bundle: .module)
            if !self.reopenWithFreshLink(because: "stalled for \(Int(limit))s", giveUp: giveUp) { self.endPlay(giveUp) }
        }
    }

    /// Asks the server for a fresh link to the playing file and plays it from where it
    /// stopped. False when there's nothing to ask (a download, the server's own stream, or
    /// enough fresh links already); the caller ends the play then.
    @discardableResult
    private func reopenWithFreshLink(because reason: String, giveUp: String) -> Bool {
        guard let current = session, current.mode == .device, !current.isOffline,
              linkRefreshes < Self.maxLinkRefreshes, let client else { return false }
        linkRefreshes += 1
        let at = position
        let wasPlaying = wantsToPlay
        Log.player.warning("\(reason, privacy: .public) on \(current.url.host ?? "?", privacy: .public); fresh link \(self.linkRefreshes, privacy: .public)")
        reportAttempts.append(PlayReport.Attempt(fileId: current.candidate.fileId, copy: Self.copyLabel(current.candidate), stage: "playing",
                                                 error: reason, servers: current.url.host.map { [PlayReport.Server(host: $0, error: reason)] } ?? []))
        restartTarget = at
        isBuffering = true
        let gen = generation
        Task { [weak self] in
            guard let self else { return }
            do {
                var res = current
                res.url = try await client.refreshLink(sessionId: current.sessionId)
                guard gen == self.generation else { return }
                Log.player.info("fresh link on \(res.url.host ?? "?", privacy: .public)")
                await self.reopen(res, at: at, wasPlaying: wasPlaying).value
                guard gen == self.generation, self.status == .playing || self.status == .paused else { return }
                self.sendReport(.recovered, message: "Played on from a fresh link after the file's server \(reason).")
            } catch {
                guard gen == self.generation else { return }
                self.restartTarget = nil
                self.endPlay(giveUp)
            }
        }
        return true
    }

    private func endPlay(_ message: String) {
        guard let current = session else { return }
        isBuffering = false
        status = .failed(message)
        let failure = Self.failure(StrataError(kind: .network, message: message), info: aether.errorInfo, res: current)
        reportAttempts.append(PlayReport.Attempt(fileId: current.candidate.fileId, copy: Self.copyLabel(current.candidate),
                                                 stage: "playing", error: failure.detail, servers: failure.servers))
        sendReport(.failed, message: message)
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
        status = .idle
        nowPlaying?.update(meta: nil, position: 0, duration: 0, rate: 0)
    }

    private func teardown(reportFinal: Bool) async {
        startToken += 1
        loadTask?.cancel()
        loadTask = nil
        restartTask?.cancel()
        restartTask = nil
        subtitleTask?.cancel()
        subtitleTask = nil
        stopStallWatch()
        if reportFinal { reportProgress(force: true) }
        wantsToPlay = false
        if let session { stopSession(session.sessionId) }
        aether.stop()
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
        cueSource = .none
        subtitleCues = []
        subtitleError = nil
        isLoadingSubtitles = false
        clearActiveCues()
        chapters = []
        nextEpisode = nil
        videoSize = nil
        aspectRatio = nil
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

    // MARK: - Engine

    /// Follows the engine: the clock (position, Now Playing, progress, subtitles), its
    /// phase (playing, paused, buffering, ended, failed) and the video's size.
    private func observeEngine() {
        aether.clock.$currentTime
            .receive(on: DispatchQueue.main)
            .sink { [weak self] time in MainActor.assumeIsolated { self?.tick(time) } }
            .store(in: &cancellables)
        aether.$playbackPhase
            .receive(on: DispatchQueue.main)
            .sink { [weak self] phase in MainActor.assumeIsolated { self?.phaseChanged(phase) } }
            .store(in: &cancellables)
        aether.$subtitleCues
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in MainActor.assumeIsolated { self?.updateEngineCues() } }
            .store(in: &cancellables)
        aether.$sourceVideoWidth.combineLatest(aether.$sourceVideoHeight)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] width, height in
                MainActor.assumeIsolated {
                    let size: CGSize? = width > 0 && height > 0 ? CGSize(width: Int(width), height: Int(height)) : nil
                    if self?.videoSize != size { self?.videoSize = size }
                }
            }
            .store(in: &cancellables)
    }

    private func tick(_ streamTime: Double) {
        guard session != nil, didStartPlayback, !starting, restartTarget == nil else { return }
        position = timeline.mediaTime(streamTime: streamTime)
        updateEngineCues()
        // The system runs the lock-screen clock from the rate; a refresh every few seconds
        // (or on a rate change) is plenty, not ten times a second.
        let rate: Float = status == .playing ? self.rate : 0
        if rate != nowPlayingRate || Date().timeIntervalSince(nowPlayingAt) >= 5 {
            nowPlayingRate = rate
            nowPlayingAt = Date()
            nowPlaying?.update(meta: meta, position: position, duration: duration, rate: rate)
        }
        if status == .playing { reportProgress(force: false) }
    }

    private func stopStallWatch() {
        stallTask?.cancel()
        stallTask = nil
    }

    private func phaseChanged(_ phase: PlaybackPhase) {
        // While a start opens its stream, it reads the phase itself (`waitUntilStarted`).
        guard session != nil, didStartPlayback, !starting else { return }
        switch phase {
        case .playing:
            stopStallWatch()
            isBuffering = false
            if restartTarget == nil, status != .playing { status = .playing }
        case .paused:
            stopStallWatch()
            isBuffering = false
            if status == .playing, restartTarget == nil {
                status = .paused
                reportProgress(force: true)
            }
        case .loading, .seeking, .rebuffering, .stalled:
            isBuffering = true
            watchForStall()
        case .ended:
            stopStallWatch()
            guard restartTarget == nil else { return }
            isBuffering = false
            status = .ended
            position = duration
            reportProgress(force: true)
        case .error(let message):
            stopStallWatch()
            failedWhilePlaying(Self.redact(message))
        case .idle:
            break
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

    /// Audio interruptions (a call, an alarm) and headphones unplugged.
    private func observeSystem() {
        #if os(iOS) || os(tvOS)
        let center = NotificationCenter.default
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
    }

    #if os(iOS) || os(tvOS)
    private func audioInterrupted(_ type: AVAudioSession.InterruptionType?, shouldResume: Bool) {
        switch type {
        case .began:
            playingBeforeInterruption = wantsToPlay && session != nil
            if playingBeforeInterruption { pause() }
        case .ended:
            if shouldResume, playingBeforeInterruption, status == .paused { play() }
            playingBeforeInterruption = false
        default:
            break
        }
    }
    #endif

    // MARK: - Reports

    /// The error as it came, with its code, for the admins' report (not shown to people).
    nonisolated static func describeRaw(_ error: Error) -> String {
        let ns = error as NSError
        let url = (ns.userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.host
        return [url, "\(redact(ns.localizedDescription)) (\(ns.domain) \(ns.code))"].compactMap { $0 }.joined(separator: ": ")
    }

    /// Text that may quote a link, with each link cut to its scheme and host: TorBox links
    /// (and the server's) carry a key in their path or query, which must not reach a
    /// report, the log or the screen.
    nonisolated static func redact(_ text: String) -> String {
        let links = #/[A-Za-z][A-Za-z0-9+.\-]*://[^\s"'<>()]+/#
        var out = text.replacing(links) { match in
            let link = String(match.output)
            guard let url = URL(string: link), let scheme = url.scheme, let host = url.host() else { return "<link>" }
            return "\(scheme)://\(host)/…"
        }
        out = out.replacing(#/(?i)(token|key|apikey|api_key|password)=[^&\s]+/#) { "\($0.output.1)=…" }
        return out
    }

    /// Whether the engine may open `url`: web links (from the server), or a file inside the
    /// app's own container for a download (`local`: a response the app built itself, which
    /// the caller knows; the response can't say so). In debug builds a file link from the
    /// server is allowed too, for tests that serve fixtures.
    nonisolated static func isOpenable(_ url: URL, local: Bool) -> Bool {
        switch url.scheme?.lowercased() {
        case "https", "http": return url.host() != nil
        case "file":
            #if DEBUG
            return true
            #else
            guard local else { return false }
            let container = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"
            return url.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(container)
            #endif
        default: return false
        }
    }

    /// How a report names a copy: "2160p · REMUX · HDR10".
    static func copyLabel(_ c: Candidate) -> String {
        let parts = [c.resolutionLabel, c.source?.uppercased(), c.hdrLabel].compactMap { $0 }
        return parts.isEmpty ? c.name : parts.joined(separator: " · ")
    }

    /// Tells the household's admins what went wrong on this load (best-effort, in the
    /// background), then starts a fresh list.
    private func sendReport(_ outcome: PlayReport.Outcome, message: String) {
        let attempts = reportAttempts
        reportAttempts = []
        guard let client, let target else { return }
        let report = PlayReport(outcome: outcome, message: message, attempts: attempts)
        Task.detached(priority: .utility) { try? await client.reportPlay(target, report) }
    }
}
