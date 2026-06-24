import Foundation
import AVFoundation
import Combine
import Observation
import StrataKit

@MainActor
@Observable
public final class PlayerEngine {
    public enum Status: Equatable { case idle, loading, ready, playing, paused, ended, failed(String) }

    public private(set) var status: Status = .idle
    public private(set) var position: TimeInterval = 0
    public private(set) var duration: TimeInterval = 0
    public private(set) var isMuted: Bool = false
    public var rate: Float = 1.0 { didSet { applyRate() } }
    public private(set) var item: BaseItem?
    public private(set) var plan: StreamPlan?

    /// Subtitle/audio tracks discovered from the active media source.
    public private(set) var audioTracks: [MediaStream] = []
    public private(set) var subtitleTracks: [MediaStream] = []
    public private(set) var activeAudioIndex: Int?
    public private(set) var activeSubtitleIndex: Int?
    public var captionsEnabled: Bool { activeSubtitleIndex != nil }

    /// Intro / credits segments (from Jellyfin MediaSegments / intro-skipper).
    public private(set) var segments: [MediaSegment] = []

    /// The skip prompt to show right now, if the playhead is inside a skippable
    /// intro or credits segment. Recomputed as `position` advances.
    public var activeSkip: SkipPrompt? {
        for seg in segments where seg.type == .intro || seg.type == .outro {
            if seg.contains(position) {
                return SkipPrompt(kind: seg.type, end: seg.end)
            }
        }
        return nil
    }

    public struct SkipPrompt: Equatable {
        public let kind: MediaSegment.Kind
        public let end: TimeInterval
        public var title: String { kind == .intro ? "Skip Intro" : "Skip Credits" }
    }

    /// When the sleep timer will pause playback, if armed.
    public private(set) var sleepTimerEnds: Date?
    private var sleepTask: Task<Void, Never>?

    public enum SleepOption: Int, CaseIterable, Identifiable, Sendable {
        case off = 0, m15 = 15, m30 = 30, m45 = 45, m60 = 60
        public var id: Int { rawValue }
        public var label: String { self == .off ? "Off" : "\(rawValue) min" }
    }

    /// `.resizeAspect` (default) preserves the source aspect ratio with letterbox/
    /// pillarbox bars — same as Apple's Photos and TV apps. `.resizeAspectFill`
    /// fills the entire frame with cropping. Persisted across launches.
    public var videoGravity: AVLayerVideoGravity {
        didSet {
            UserDefaults.standard.set(videoGravity.rawValue, forKey: Self.videoGravityKey)
        }
    }
    private static let videoGravityKey = "strata.videoGravity"

    public func toggleVideoGravity() {
        videoGravity = (videoGravity == .resizeAspect) ? .resizeAspectFill : .resizeAspect
    }

    public func setVideoGravity(_ gravity: AVLayerVideoGravity) {
        guard gravity != videoGravity else { return }
        videoGravity = gravity
    }

    public let player: AVPlayer = {
        let p = AVPlayer()
        p.automaticallyWaitsToMinimizeStalling = true
        p.appliesMediaSelectionCriteriaAutomatically = true
        p.allowsExternalPlayback = true
        return p
    }()

    public weak var client: JellyfinClientHolder?

    public var images: ImageURLBuilder?
    public var session: Session?

    private var reporter: PlaybackReporter?
    private var timeObserverToken: Any?
    private var statusObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var nowPlaying: NowPlayingBridge?

    private var jellyfin: JellyfinClient?

    public init() {
        if let raw = UserDefaults.standard.string(forKey: Self.videoGravityKey) {
            self.videoGravity = AVLayerVideoGravity(rawValue: raw)
        } else {
            self.videoGravity = .resizeAspect
        }
    }

    public func configure(client: JellyfinClient, nowPlaying: NowPlayingBridge? = nil) {
        self.jellyfin = client
        self.session = client.session
        self.images = client.session.map { ImageURLBuilder(session: $0) }
        self.nowPlaying = nowPlaying
    }

    public func load(item: BaseItem) async {
        guard let jellyfin else { status = .failed("No client configured"); return }
        // A reload of the *same* item (an audio/subtitle switch re-plans the
        // stream) must keep the viewer's chosen audio track; a genuinely new
        // item falls back to the source's default below.
        let isReload = self.item?.id == item.id
        await teardownCurrentItem()
        self.item = item
        status = .loading
        do {
            let planner = StreamPlanner(client: jellyfin)
            let plan = try await planner.plan(itemId: item.id,
                                              audioStreamIndex: activeAudioIndex,
                                              subtitleStreamIndex: activeSubtitleIndex)
            self.plan = plan
            // Build URL and player item
            let url = plan.preferHLS ? plan.hlsURL : plan.directURL
            let asset = AVURLAsset(url: url)
            let playerItem = AVPlayerItem(asset: asset)
            player.replaceCurrentItem(with: playerItem)

            // Surface tracks from the bundled item when present; only
            // re-fetch when mediaSources are missing (some list-view
            // models drop them to keep payloads small). The re-fetch
            // used to be unconditional and blocked play() on a second
            // round-trip after StreamPlanner already returned.
            let bundledSource = item.mediaSources?.first { $0.id == plan.mediaSourceId }
            let source: MediaSource?
            if let bundledSource, (bundledSource.mediaStreams?.isEmpty == false) {
                source = bundledSource
            } else {
                source = (try? await jellyfin.getItem(item.id))?.mediaSources?.first { $0.id == plan.mediaSourceId }
            }
            audioTracks = (source?.mediaStreams ?? []).filter { $0.type == .audio }
            subtitleTracks = (source?.mediaStreams ?? []).filter { $0.type == .subtitle }
            // Keep the viewer's audio choice across a same-item reload; otherwise
            // pick the source's default (or first) track. Without this guard the
            // reload triggered by selectAudio(_:) would snap straight back to the
            // default, leaving the picker's checkmark out of sync with playback.
            let keepsAudio = isReload && audioTracks.contains { $0.index == activeAudioIndex }
            if !keepsAudio {
                activeAudioIndex = audioTracks.first(where: { $0.isDefault ?? false })?.index ?? audioTracks.first?.index
            }
            // Subtitles default to off until user enables.

            duration = item.runtimeSeconds ?? 0
            attachObservers(playerItem: playerItem)

            if let resume = item.resumePositionSeconds, resume > 5 {
                await seek(to: resume)
            }

            // Intro/credits markers — fire-and-forget so they never delay
            // playback. Empty (no plugin / unanalysed) simply shows no button.
            Task { [weak self] in
                let segs = (try? await jellyfin.mediaSegments(itemId: item.id)) ?? []
                await MainActor.run { self?.segments = segs }
            }

            let r = PlaybackReporter(client: jellyfin, itemId: item.id, plan: plan)
            reporter = r
            // Fire-and-forget: server bookkeeping doesn't belong on the
            // critical play() path. Awaiting it adds a serial round-trip
            // between the AVPlayerItem being ready and the call to play().
            Task { await r.start() }
            status = .ready
            nowPlaying?.update(item: item, position: position, duration: duration, rate: rate)
            player.play()
            applyRate()
        } catch {
            status = .failed((error as? JellyfinClient.RequestError)?.message ?? error.localizedDescription)
        }
    }

    public func play() { player.play(); status = .playing }

    public func pause() {
        player.pause()
        status = .paused
        Task { await reporter?.tick(positionSeconds: position, isPaused: true) }
    }

    public func togglePlay() {
        switch status {
        case .playing: pause()
        case .paused, .ready, .ended: play()
        default: break
        }
    }

    public func skip(_ delta: TimeInterval) async {
        await seek(to: position + delta)
    }

    /// Jump to the end of the intro/credits segment the playhead is currently in.
    public func skipActiveSegment() async {
        guard let prompt = activeSkip else { return }
        await seek(to: prompt.end)
    }

    /// Arm (or, with `.off`, disarm) the sleep timer. Pauses playback when it
    /// fires. Survives auto-advance to the next episode; cleared on `unload()`.
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

    public func seek(to seconds: TimeInterval) async {
        let cm = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
        await player.seek(to: cm, toleranceBefore: .zero, toleranceAfter: .zero)
        position = seconds
    }

    public func toggleMute() {
        isMuted.toggle()
        player.isMuted = isMuted
    }

    /// Cycle through 1.0 → 1.25 → 1.5 → 2.0 → 1.0.
    public func cycleSpeed() {
        let cycle: [Float] = [1.0, 1.25, 1.5, 2.0]
        let next = cycle.first(where: { $0 > rate }) ?? cycle.first ?? 1.0
        rate = next
    }

    /// Pick a new audio stream — triggers reload of the stream plan with the
    /// updated audio index so Jellyfin can switch tracks server-side.
    public func selectAudio(_ stream: MediaStream) async {
        guard let item, stream.index != activeAudioIndex else { return }
        activeAudioIndex = stream.index
        let resumeAt = position
        await load(item: item)
        await seek(to: resumeAt)
    }

    public func selectSubtitle(_ stream: MediaStream?) async {
        guard let item else { return }
        activeSubtitleIndex = stream?.index
        let resumeAt = position
        await load(item: item)
        await seek(to: resumeAt)
    }

    public func unload() async {
        sleepTask?.cancel()
        sleepTimerEnds = nil
        await teardownCurrentItem()
        status = .idle
    }

    private func applyRate() {
        if status == .playing { player.rate = rate }
    }

    private func attachObservers(playerItem: AVPlayerItem) {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.position = CMTimeGetSeconds(time)
                if self.duration <= 0, let d = self.player.currentItem?.duration.seconds, d.isFinite {
                    self.duration = d
                }
                self.nowPlaying?.update(item: self.item, position: self.position, duration: self.duration, rate: self.rate)
                Task { [weak self] in
                    guard let self else { return }
                    await self.reporter?.tick(positionSeconds: self.position, isPaused: self.status == .paused)
                }
            }
        }
        statusObservation = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self else { return }
                switch item.status {
                case .readyToPlay:
                    let d = item.duration.seconds
                    if d.isFinite, d > 0 { self.duration = d }
                    if self.status == .loading { self.status = .ready }
                case .failed:
                    self.status = .failed(item.error?.localizedDescription ?? "Failed to load")
                default: break
                }
            }
        }
        rateObservation = player.observe(\.rate, options: [.new]) { [weak self] p, _ in
            Task { @MainActor in
                guard let self else { return }
                if p.rate > 0 { self.status = .playing }
                else if self.status == .playing { self.status = .paused }
            }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.status = .ended
                await self.reporter?.stop(positionSeconds: self.duration)
            }
        }
    }

    private func teardownCurrentItem() async {
        if let token = timeObserverToken {
            player.removeTimeObserver(token)
            timeObserverToken = nil
        }
        statusObservation = nil
        rateObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        await reporter?.stop(positionSeconds: position)
        reporter = nil
        player.replaceCurrentItem(with: nil)
        position = 0
        duration = 0
        segments = []
    }
}

/// Allows the engine to hold a weak reference to a wrapper around `JellyfinClient`
/// — used by future caching layers; safe placeholder for now.
public protocol JellyfinClientHolder: AnyObject {}
