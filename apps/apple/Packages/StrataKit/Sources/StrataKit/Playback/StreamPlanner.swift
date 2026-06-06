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
        let sourceBitrate = videoStream?.bitRate ?? source.bitrate ?? 20_000_000

        // Direct stream
        let directQ: [URLQueryItem] = [
            .init(name: "Static", value: "true"),
            .init(name: "MediaSourceId", value: mediaSourceId),
            .init(name: "api_key", value: token),
            .init(name: "PlaySessionId", value: playSessionId)
        ]
        guard var directComps = URLComponents(
            url: client.serverURL.appendingPathComponent("/Videos/\(itemId)/stream"),
            resolvingAgainstBaseURL: false
        ) else {
            throw JellyfinClient.RequestError.invalidURL
        }
        directComps.queryItems = directQ
        guard let directURL = directComps.url else {
            throw JellyfinClient.RequestError.invalidURL
        }

        // HLS URL: prefer the server's TranscodingUrl when it returned
        // one — Jellyfin built it from the DeviceProfile we sent, so it
        // already has the right per-source params (audio-only transcode
        // when video matches, subtitle burn-in when needed, etc.). Fall
        // back to a hand-built URL only when the server didn't supply
        // one (older Jellyfin or unusual edge case).
        let hlsURL: URL? = {
            if let raw = source.transcodingUrl,
               let abs = URL(string: raw, relativeTo: client.serverURL)?.absoluteURL,
               var comps = URLComponents(url: abs, resolvingAgainstBaseURL: false) {
                // AVPlayer fetches manifest and segments with a plain
                // URLSession that can't carry our X-Emby-Authorization
                // header. Inject api_key if Jellyfin didn't embed one.
                var items = comps.queryItems ?? []
                if !items.contains(where: { $0.name == "api_key" }), !token.isEmpty {
                    items.append(.init(name: "api_key", value: token))
                    comps.queryItems = items
                }
                if let url = comps.url { return url }
            }
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
            guard var hlsComps = URLComponents(
                url: client.serverURL.appendingPathComponent("/Videos/\(itemId)/master.m3u8"),
                resolvingAgainstBaseURL: false
            ) else { return nil }
            hlsComps.queryItems = hlsQ
            return hlsComps.url
        }()
        guard let hlsURL else {
            throw JellyfinClient.RequestError.invalidURL
        }

        // Authoritative: Jellyfin evaluated the file against the
        // DeviceProfile we sent. If it says DirectPlay works, AVPlayer
        // gets the raw file (byte-range fetches, instant seeks). The
        // hardcoded container/codec gate that used to live here couldn't
        // see AVFoundation's actual capability and was overly
        // conservative on MKV.
        let preferHLS = !(source.supportsDirectPlay ?? false)

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
