import Foundation

/// Converts between **media time** (position in the title, what the UI, progress reports
/// and subtitle cues use) and **stream time** (AVPlayer's clock for the current item).
///
/// Direct play: the stream is the whole file, so the two match. HLS: the server starts
/// encoding at the resume point, so the stream's t=0 sits at `startOffset` and the playlist
/// is an EVENT playlist that grows as ffmpeg works — its duration can't be trusted, the
/// server's `durationMs` can.
public struct MediaTimeline: Sendable, Equatable {
    /// Media time (s) at stream t=0.
    public var startOffset: TimeInterval
    /// Full title duration (s).
    public var duration: TimeInterval
    public var isHLS: Bool

    public init(startOffset: TimeInterval, duration: TimeInterval, isHLS: Bool) {
        self.startOffset = startOffset
        self.duration = duration
        self.isHLS = isHLS
    }

    public init(_ response: PlayResponse) {
        self.init(startOffset: response.startOffset, duration: response.duration, isHLS: response.mode.isHLS)
    }

    /// Clamps to 0...duration (when the duration is known).
    public func clamp(_ media: TimeInterval) -> TimeInterval {
        let lower = max(0, media)
        return duration > 0 ? min(lower, duration) : lower
    }

    public func mediaTime(streamTime: TimeInterval) -> TimeInterval {
        guard streamTime.isFinite else { return startOffset }
        return clamp(startOffset + streamTime)
    }

    public func streamTime(mediaTime: TimeInterval) -> TimeInterval {
        max(0, mediaTime - startOffset)
    }

    /// Where to seek after a direct-play item becomes ready (`seekToMs`, stream time).
    public static func initialSeek(_ response: PlayResponse) -> TimeInterval? {
        response.seekToMs > 0 ? TimeInterval(response.seekToMs) / 1000 : nil
    }

    public enum SeekPlan: Equatable, Sendable {
        /// Seek the current item to this stream time.
        case inPlace(stream: TimeInterval)
        /// Outside what the current HLS stream can reach: start a new session at this media time.
        case restart(media: TimeInterval)
    }

    /// Decides how to reach `media`. `seekable` are the item's `seekableTimeRanges` in stream
    /// time. Direct play always seeks in place. For HLS, a target before the stream's start,
    /// or more than `tolerance` past the end of what's been encoded, needs a restart.
    public func plan(seekTo media: TimeInterval, seekable: [ClosedRange<TimeInterval>], tolerance: TimeInterval = 2) -> SeekPlan {
        let target = clamp(media)
        guard isHLS else { return .inPlace(stream: target) }
        let stream = target - startOffset
        if stream < -0.5 { return .restart(media: target) }
        let s = max(0, stream)
        for range in seekable where s >= range.lowerBound - 0.5 && s <= range.upperBound + tolerance {
            return .inPlace(stream: min(s, range.upperBound))
        }
        return .restart(media: target)
    }

    /// Whole-ms media time for progress reports.
    public func ms(_ seconds: TimeInterval) -> Int {
        guard seconds.isFinite else { return 0 }
        return Int((seconds * 1000).rounded())
    }
}
