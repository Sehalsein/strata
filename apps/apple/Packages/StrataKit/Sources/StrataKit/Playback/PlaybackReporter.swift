import Foundation

/// Reports playback lifecycle + progress to the Jellyfin server.
/// Progress is reported on every `tick(position:isPaused:)` call but throttled
/// to at most one network request per `progressInterval` (default 10s) plus
/// a forced report on every pause/resume transition.
public actor PlaybackReporter {
    public let client: JellyfinClient
    public let itemId: String
    public let playSessionId: String
    public let mediaSourceId: String
    public var progressInterval: TimeInterval = 10

    private var lastReportedAt: Date?
    private var lastIsPaused: Bool?
    private var hasStarted = false
    private var hasStopped = false

    public init(client: JellyfinClient, itemId: String, plan: StreamPlan) {
        self.client = client
        self.itemId = itemId
        self.playSessionId = plan.playSessionId
        self.mediaSourceId = plan.mediaSourceId
    }

    public func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        try? await client.reportPlaybackStart(
            itemId: itemId,
            playSessionId: playSessionId,
            mediaSourceId: mediaSourceId
        )
    }

    public func tick(positionSeconds: TimeInterval, isPaused: Bool) async {
        guard hasStarted, !hasStopped else { return }
        let now = Date()
        let pauseChanged = (lastIsPaused != isPaused)
        let intervalElapsed = lastReportedAt.map { now.timeIntervalSince($0) >= progressInterval } ?? true
        guard pauseChanged || intervalElapsed else { return }
        lastReportedAt = now
        lastIsPaused = isPaused
        try? await client.reportPlaybackProgress(
            itemId: itemId,
            playSessionId: playSessionId,
            mediaSourceId: mediaSourceId,
            positionSeconds: positionSeconds,
            isPaused: isPaused
        )
    }

    public func stop(positionSeconds: TimeInterval) async {
        guard hasStarted, !hasStopped else { return }
        hasStopped = true
        try? await client.reportPlaybackStopped(
            itemId: itemId,
            playSessionId: playSessionId,
            mediaSourceId: mediaSourceId,
            positionSeconds: positionSeconds
        )
    }
}
