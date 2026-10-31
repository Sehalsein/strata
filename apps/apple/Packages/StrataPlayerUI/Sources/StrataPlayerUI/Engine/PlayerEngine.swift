import Foundation
import AVFoundation
import Combine
import Observation
import StrataKit
import StrataRemux

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
    /// Media time, seconds.
    public private(set) var position: TimeInterval = 0
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
    /// Parsed cues of the active track, in media time.
    public private(set) var subtitleCues: [VTTCue] = []
    /// Text to draw right now (overlapping cues joined by a newline), nil when nothing shows.
    public var activeCueText: String? {
        guard !subtitleCues.isEmpty else { return nil }
        let t = position
        let texts = subtitleCues.lazy.filter { t >= $0.start && t <= $0.end }.map(\.text)
        let joined = texts.joined(separator: "\n")
        return joined.isEmpty ? nil : joined
    }

    public private(set) var chapters: [Chapter] = []
    public var currentChapter: Chapter? { chapters.last { $0.start <= position } }
    /// What Up Next should offer (episodes only).
    public private(set) var nextEpisode: NextEpisode?
    public var nextTarget: PlaybackTarget? {
        guard let target, let next = nextEpisode else { return nil }
        return target.with(season: next.season, episode: next.episode)
    }

    /// When the sleep timer will pause playback, if armed.
    public private(set) var sleepTimerEnds: Date?
    private var sleepTask: Task<Void, Never>?

    public enum SleepOption: Int, CaseIterable, Identifiable, Sendable {
        case off = 0, m15 = 15, m30 = 30, m45 = 45, m60 = 60
        public var id: Int { rawValue }
        public var label: String { self == .off ? "Off" : "\(rawValue) min" }
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
    /// Media time being restarted to; the timeline isn't trusted until the new item plays.
    private var restartTarget: TimeInterval?
    /// Files whose media info this load already read for the server (see `probe`).
    private var probedFiles = Set<Int>()
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

    /// Progress is reported this often while playing.
    public var progressInterval: TimeInterval = 10
    /// How long rapid scrubs are coalesced before an HLS restart.
    public var restartDebounce: TimeInterval = 0.4
    /// How often a source the server is getting ready is asked about again.
    public var preparePollInterval: TimeInterval = 5

    public init() {
        if let raw = UserDefaults.standard.string(forKey: Self.videoGravityKey) {
            videoGravity = AVLayerVideoGravity(rawValue: raw)
        } else {
            videoGravity = .resizeAspect
        }
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
        guard let client else { status = .failed("Not connected to a server."); return }
        await teardown(reportFinal: true)
        generation += 1
        let gen = generation
        skipNativeSubtitles = false
        probedFiles = []
        self.target = target
        self.meta = meta
        status = .loading
        position = startMs.map { TimeInterval($0) / 1000 } ?? 0
        nowPlaying?.update(meta: meta, position: position, duration: duration, rate: 0)

        let task = Task { [weak self] in
            guard let self else { return }
            do {
                let res = try await self.requestPlay(client: client, target: target, candidateId: candidateId, startMs: startMs, audioIndex: nil, gen: gen)
                try await self.start(res, gen: gen, newTitle: true, autoplay: true)
            } catch let failure as DeviceFailure {
                guard gen == self.generation else { return }
                Log.player.warning("device play failed: \(failure.message, privacy: .public)")
                self.status = .failed(failure.message)
            } catch {
                guard gen == self.generation, !(error is CancellationError) else { return }
                let e = StrataError.wrap(error)
                if e.kind != .cancelled { self.status = .failed(e.message) }
            }
        }
        loadTask = task
        await task.value
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
            switch try await client.play(target, candidateId: candidateId, startMs: startMs, audioStreamIndex: audioIndex) {
            case .started(let res):
                guard gen == generation else { throw CancellationError() }
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
        guard probedFiles.insert(fileId).inserted else {
            throw DeviceFailure(message: "The server couldn't use what this file holds. Pick another source.")
        }
        status = .loading
        let info: MediaInfo
        do {
            // MediaProbe reads on its own queue; the main actor only waits.
            info = try await MediaProbe.probe(url: url)
        } catch {
            guard gen == generation, !(error is CancellationError) else { throw CancellationError() }
            Log.player.warning("probe failed: \(error.localizedDescription, privacy: .public)")
            throw DeviceFailure(message: "This file couldn't be read (\(error.localizedDescription)). Pick another source.")
        }
        guard gen == generation else { throw CancellationError() }
        try await client.reportProbe(fileId: fileId, info: info)
        guard gen == generation else { throw CancellationError() }
    }

    /// Installs a play response as the current item. `newTitle` resets tracks/subtitles;
    /// otherwise (seek restart / audio switch) the subtitle selection and cues carry over.
    private func start(_ res: PlayResponse, gen: Int, newTitle: Bool, autoplay: Bool) async throws {
        guard gen == generation else { throw CancellationError() }
        let previous = session
        let previousRemux = remux
        // Device mode: open the file and repackage it here before anything changes on screen.
        var url = res.url
        var newRemux: RemuxSession?
        if res.mode == .device {
            let local = makeRemux(res)
            do {
                url = try await local.start()
                #if os(iOS)
                // An Apple TV on AirPlay fetches the stream itself: it gets the Wi-Fi address.
                if player.isExternalPlaybackActive { url = try await local.networkPlaylistURL() }
                #endif
            } catch {
                local.stop()
                guard gen == generation else { throw CancellationError() }
                throw DeviceFailure(message: "This file couldn't be opened (\(error.localizedDescription)). Pick another source.")
            }
            guard gen == generation else { local.stop(); throw CancellationError() }
            newRemux = local
        }
        removeObservers()

        session = res
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

        if res.mode.isHLS { try await waitForPlaylist(res.url, gen: gen) }
        let item = AVPlayerItem(url: url)
        // Start buffering a little ahead; long forward buffers waste server work on a remux.
        // On the device a minute ahead rides out a slow patch in the network.
        switch res.mode {
        case .remux, .transcode: item.preferredForwardBufferDuration = 30
        case .device: item.preferredForwardBufferDuration = 60
        case .direct: item.preferredForwardBufferDuration = 0
        }
        player.replaceCurrentItem(with: item)
        attachObservers(item)
        isBuffering = true
        remux = newRemux
        if newTitle || res.mode != .device { embeddedCues = [:] }
        if previousRemux !== newRemux { previousRemux?.stop() }
        if let previous, previous.sessionId != res.sessionId { stopSession(previous.sessionId) }

        do {
            try await waitUntilReady(item)
        } catch let error as StrataError where res.mode == .device {
            guard gen == generation else { throw CancellationError() }
            if !skipNativeSubtitles, newRemux?.subtitleRenditions.isEmpty == false {
                // Try once more without the subtitle tracks before giving up on the device.
                Log.player.warning("stream with subtitle tracks refused (\(error.message, privacy: .public)); trying without")
                skipNativeSubtitles = true
                return try await start(res, gen: gen, newTitle: newTitle, autoplay: autoplay)
            }
            // AVPlayer refused what the device made (a codec it can't decode, say).
            throw DeviceFailure(message: "This file can't play on this device (\(error.message)). Pick another source.")
        }
        guard gen == generation else { throw CancellationError() }
        #if os(tvOS)
        if newTitle || displayCriteria == nil {
            if let format = newRemux?.videoFormat {
                displayCriteria = DisplayMatch.criteria(for: format)
            } else if res.mode == .direct {
                displayCriteria = await DisplayMatch.criteria(for: item.asset)
            }
        }
        #endif
        nativeSubtitles = res.mode == .device ? try? await item.asset.loadMediaSelectionGroup(for: .legible) : nil
        guard gen == generation else { throw CancellationError() }
        if let seek = MediaTimeline.initialSeek(res) {
            await player.seek(to: CMTime(seconds: seek, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        guard gen == generation else { throw CancellationError() }
        restartTarget = nil
        didStartPlayback = true
        position = timeline.mediaTime(streamTime: player.currentTime().seconds)
        status = .ready
        if autoplay {
            player.playImmediately(atRate: rate)
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

    /// Waits for the item to become playable. Polls rather than bridging KVO into an
    /// async sequence: `publisher(for:).values` never yielded here, leaving loads stuck.
    private func waitUntilReady(_ item: AVPlayerItem, timeout: TimeInterval = 45) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            switch item.status {
            case .readyToPlay: return
            case .failed: throw StrataError(kind: .network, message: Self.describe(item.error))
            default: break
            }
            guard Date() < deadline else { throw StrataError(kind: .network, message: "The stream didn't start in time. Try again.") }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    // MARK: - Transport

    public func play() {
        guard player.currentItem != nil else { return }
        if status == .ended { Task { await seek(to: 0) } }
        player.playImmediately(atRate: rate)
        status = .playing
    }

    public func pause() {
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
        let gen = generation
        let wasPlaying = status == .playing || status == .ended || status == .ready
        restartTask = Task { [weak self] in
            guard let self else { return }
            if debounce {
                try? await Task.sleep(nanoseconds: UInt64(self.restartDebounce * 1_000_000_000))
            }
            guard !Task.isCancelled, gen == self.generation, let client = self.client, let target = self.target, let current = self.session else { return }
            self.player.pause()
            self.isBuffering = true
            do {
                let res = try await self.requestPlay(client: client, target: target, candidateId: current.candidate.id,
                                                     startMs: Int((media * 1000).rounded()), audioIndex: audioIndex, gen: gen)
                guard !Task.isCancelled else { return }
                try await self.start(res, gen: gen, newTitle: false, autoplay: wasPlaying)
            } catch {
                guard gen == self.generation, !(error is CancellationError), !Task.isCancelled else { return }
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
    /// (the server may take a moment to extract embedded ones); bitmap tracks can't be shown.
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
        if track.isEmbedded, let index = track.streamIndex {
            activeSubtitleId = track.id
            isLoadingSubtitles = false
            // The player draws it from the stream; otherwise the overlay shows the lines read
            // from the file so far.
            subtitleCues = nativeOption(for: track) == nil ? embeddedCues[index] ?? [] : []
            return
        }
        guard let url = track.url else {
            subtitleError = "\(track.displayTitle) is an image-based subtitle and can't be shown yet."
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
                let cues = WebVTT.parse(text).sorted { $0.start < $1.start }
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
            t.forced && t.isTextBased && (audioLang == nil || LanguageName.normalized(t.language) == audioLang)
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
        return local
    }

    /// Keeps lines read from the file, and shows them when their track is on.
    private func receive(_ cues: [SubtitleCue], from source: RemuxSession) {
        guard source === remux else { return }
        var touched = Set<Int>()
        for cue in cues {
            let index = Int(cue.streamIndex)
            let line = VTTCue(start: cue.start, end: cue.end, text: cue.text)
            // A new session after an audio switch reads some of the same lines again.
            guard embeddedCues[index]?.contains(line) != true else { continue }
            embeddedCues[index, default: []].append(line)
            touched.insert(index)
        }
        for index in touched { embeddedCues[index]?.sort { $0.start < $1.start } }
        if let active = activeSubtitle, active.isEmbedded, let index = active.streamIndex, touched.contains(index),
           nativeOption(for: active) == nil {
            subtitleCues = embeddedCues[index] ?? []
        }
    }

    /// Switches audio by repackaging the same file with the other track, at the same spot.
    /// Nothing goes to the server.
    private func switchDeviceAudio(to track: AudioTrack, in current: PlayResponse) async {
        restartTask?.cancel()
        let gen = generation
        let at = position
        let wasPlaying = status == .playing || status == .ended || status == .ready
        var res = current
        res.remux?.audioStreamIndex = track.index
        res.remux?.audio = Self.copyableAudio.contains(track.codec.lowercased()) ? "copy" : "lossless"
        res.audioTracks = current.audioTracks.map { var t = $0; t.selected = t.index == track.index; return t }
        res.seekToMs = timeline.ms(at)
        activeAudioIndex = track.index
        await restartDevice(res, at: at, wasPlaying: wasPlaying, gen: gen)
    }

    /// Repackages the file again from `at` (another audio track, or a new address for
    /// AirPlay). Nothing goes to the server.
    private func restartDevice(_ res: PlayResponse, at: TimeInterval, wasPlaying: Bool, gen: Int) async {
        var res = res
        res.seekToMs = timeline.ms(at)
        player.pause()
        isBuffering = true
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.start(res, gen: gen, newTitle: false, autoplay: wasPlaying)
            } catch {
                guard gen == self.generation, !(error is CancellationError), !Task.isCancelled else { return }
                self.status = .failed((error as? DeviceFailure)?.message ?? StrataError.wrap(error).message)
            }
        }
        restartTask = task
        await task.value
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
        restartTask?.cancel()
        let gen = generation
        let at = position
        let wasPlaying = status == .playing || status == .ready
        restartTask = Task { [weak self] in await self?.restartDevice(current, at: at, wasPlaying: wasPlaying, gen: gen) }
    }
    #endif

    // MARK: - Unload

    /// Stops playback: reports the final position, ends the server session, clears state.
    public func unload() async {
        sleepTask?.cancel()
        sleepTimerEnds = nil
        await teardown(reportFinal: true)
        generation += 1
        target = nil
        meta = nil
        #if os(tvOS)
        displayCriteria = nil
        #endif
        status = .idle
        nowPlaying?.update(meta: nil, position: 0, duration: 0, rate: 0)
    }

    private func teardown(reportFinal: Bool) async {
        loadTask?.cancel()
        loadTask = nil
        restartTask?.cancel()
        restartTask = nil
        subtitleTask?.cancel()
        subtitleTask = nil
        if reportFinal { reportProgress(force: true) }
        if let session { stopSession(session.sessionId) }
        removeObservers()
        player.pause()
        player.replaceCurrentItem(with: nil)
        remux?.stop()
        remux = nil
        embeddedCues = [:]
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
        guard let client else { return }
        Task.detached { try? await client.stopPlayback(sessionId: id) }
    }

    // MARK: - Progress

    @ObservationIgnored private var reportChain: Task<Void, Never>?
    @ObservationIgnored private var nowPlayingAt = Date.distantPast
    @ObservationIgnored private var nowPlayingRate: Float = -1

    private func reportProgress(force: Bool) {
        guard let client, let target, let session, didStartPlayback else { return }
        let ms = timeline.ms(restartTarget ?? position)
        guard force || Date().timeIntervalSince(lastReportAt) >= progressInterval else { return }
        guard ms != lastReportedMs || force else { return }
        lastReportAt = Date()
        lastReportedMs = ms
        let durationMs = session.durationMs
        let sessionId = session.sessionId
        // In order: a slow earlier report must never land after (and overwrite) a later one.
        let previous = reportChain
        reportChain = Task.detached {
            await previous?.value
            do {
                try await client.reportProgress(target, positionMs: ms, durationMs: durationMs, sessionId: sessionId)
            } catch {
                Log.player.warning("progress report failed: \(StrataError.wrap(error).message, privacy: .public)")
            }
        }
    }

    // MARK: - Observers

    private func applyRate() {
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
            }
        }
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let failed = item.status == .failed
            let message = Self.describe(item.error)
            Task { @MainActor [weak self] in
                guard let self, failed, self.player.currentItem === item else { return }
                self.status = .failed(message)
                self.isBuffering = false
            }
        }
        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            let tcs = p.timeControlStatus
            Task { @MainActor [weak self] in
                guard let self, self.session != nil else { return }
                self.isBuffering = tcs == .waitingToPlayAtSpecifiedRate || self.restartTarget != nil
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
        guard let error else { return "Playback failed." }
        let ns = error as NSError
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSURLErrorDomain {
            return StrataError.wrap(URLError(URLError.Code(rawValue: underlying.code))).message
        }
        return ns.localizedFailureReason ?? ns.localizedDescription
    }
}
