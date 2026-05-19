import Foundation

public struct StreamPlan: Sendable, Equatable {
    public let directURL: URL
    public let hlsURL: URL
    public let playSessionId: String
    public let mediaSourceId: String
    public let preferHLS: Bool
    public let bitrate: Int?
    public let container: String?
    public let videoCodec: String?
    public let audioCodec: String?
}

public struct StreamPlanner: Sendable {
    public let client: JellyfinClient

    public init(client: JellyfinClient) {
        self.client = client
    }

    private static let browserSafeContainers: Set<String> = ["mp4", "m4v", "mov"]
    /// AVFoundation handles a wider audio set than the browser does;
    /// AAC + AC-3 + E-AC-3 + Apple Lossless + MP3 all direct-play on iOS/Mac.
    private static let avfSafeAudioCodecs: Set<String> = ["aac", "ac3", "eac3", "alac", "mp3"]

    public func plan(
        itemId: String,
        audioStreamIndex: Int? = nil,
        subtitleStreamIndex: Int? = nil
    ) async throws -> StreamPlan {
        let info = try await client.playbackInfo(
            itemId: itemId,
            audioStreamIndex: audioStreamIndex,
            subtitleStreamIndex: subtitleStreamIndex
        )
        guard let source = info.mediaSources?.first else {
            throw JellyfinClient.RequestError.http(status: 0, body: "No media source returned")
        }
        let playSessionId = info.playSessionId ?? ""
        let token = client.session?.token ?? ""
        let mediaSourceId = source.id

        let container = (source.container ?? "").lowercased().split(separator: ",").first.map(String.init)
        let videoStream = pickStream(in: source, type: .video)
        let audioStream = pickStream(in: source, type: .audio, preferIndex: audioStreamIndex)
        let containerOK = container.map(Self.browserSafeContainers.contains) ?? false
        let audioOK = Self.avfSafeAudioCodecs.contains((audioStream?.codec ?? "").lowercased())
        let preferHLS = !(containerOK && audioOK)
        let sourceBitrate = videoStream?.bitRate ?? source.bitrate ?? 20_000_000

        // Direct stream
        let directQ: [URLQueryItem] = [
            .init(name: "Static", value: "true"),
            .init(name: "MediaSourceId", value: mediaSourceId),
            .init(name: "api_key", value: token),
            .init(name: "PlaySessionId", value: playSessionId)
        ]
        var directComps = URLComponents(
            url: client.serverURL.appendingPathComponent("/Videos/\(itemId)/stream"),
            resolvingAgainstBaseURL: false
        )!
        directComps.queryItems = directQ
        let directURL = directComps.url!

        // HLS — h264 high@5.1 + AAC, TS segments. Same recipe as web.
        var hlsQ: [URLQueryItem] = [
            .init(name: "MediaSourceId", value: mediaSourceId),
            .init(name: "PlaySessionId", value: playSessionId),
            .init(name: "api_key", value: token),
            .init(name: "VideoCodec", value: "h264"),
            .init(name: "AudioCodec", value: "aac"),
            .init(name: "TranscodingMaxAudioChannels", value: "6"),
            .init(name: "SegmentContainer", value: "ts"),
            .init(name: "MinSegments", value: "1"),
            .init(name: "BreakOnNonKeyFrames", value: "true"),
            .init(name: "h264-level", value: "51"),
            .init(name: "h264-profile", value: "high"),
            .init(name: "VideoBitrate", value: String(sourceBitrate))
        ]
        if let vIdx = videoStream?.index { hlsQ.append(.init(name: "VideoStreamIndex", value: String(vIdx))) }
        if let a = audioStreamIndex { hlsQ.append(.init(name: "AudioStreamIndex", value: String(a))) }
        if let s = subtitleStreamIndex { hlsQ.append(.init(name: "SubtitleStreamIndex", value: String(s))) }
        var hlsComps = URLComponents(
            url: client.serverURL.appendingPathComponent("/Videos/\(itemId)/master.m3u8"),
            resolvingAgainstBaseURL: false
        )!
        hlsComps.queryItems = hlsQ
        let hlsURL = hlsComps.url!

        return StreamPlan(
            directURL: directURL,
            hlsURL: hlsURL,
            playSessionId: playSessionId,
            mediaSourceId: mediaSourceId,
            preferHLS: preferHLS,
            bitrate: videoStream?.bitRate ?? source.bitrate,
            container: container,
            videoCodec: videoStream?.codec,
            audioCodec: audioStream?.codec
        )
    }

    private func pickStream(in source: MediaSource, type: StreamKind, preferIndex: Int? = nil) -> MediaStream? {
        let all = source.mediaStreams ?? []
        if let preferIndex {
            if let s = all.first(where: { $0.type == type && $0.index == preferIndex }) { return s }
        }
        if let def = all.first(where: { $0.type == type && ($0.isDefault ?? false) }) { return def }
        return all.first(where: { $0.type == type })
    }
}
