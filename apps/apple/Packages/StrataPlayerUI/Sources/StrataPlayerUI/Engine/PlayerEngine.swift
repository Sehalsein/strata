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

            // Surface tracks from the planned media source. We re-fetch the
            // item to pick up media streams if the bundled item lacks them.
            let source = (try? await jellyfin.getItem(item.id))?.mediaSources?.first { $0.id == plan.mediaSourceId }
                ?? item.mediaSources?.first { $0.id == plan.mediaSourceId }
            audioTracks = (source?.mediaStreams ?? []).filter { $0.type == .audio }
            subtitleTracks = (source?.mediaStreams ?? []).filter { $0.type == .subtitle }
            activeAudioIndex = audioTracks.first(where: { $0.isDefault ?? false })?.index ?? audioTracks.first?.index
            // Subtitles default to off until user enables.

            duration = item.runtimeSeconds ?? 0
            attachObservers(playerItem: playerItem)

            if let resume = item.resumePositionSeconds, resume > 5 {
                await seek(to: resume)
            }

            reporter = PlaybackReporter(client: jellyfin, itemId: item.id, plan: plan)
            await reporter?.start()
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
    }
}

/// Allows the engine to hold a weak reference to a wrapper around `JellyfinClient`
/// — used by future caching layers; safe placeholder for now.
public protocol JellyfinClientHolder: AnyObject {}
