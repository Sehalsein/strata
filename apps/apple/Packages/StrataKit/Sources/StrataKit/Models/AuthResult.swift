import Foundation

public struct AuthResult: Codable, Hashable, Sendable {
    public let accessToken: String
    public let user: AuthUser
    public let serverId: String?
    public let sessionInfo: SessionInfo?

    public enum CodingKeys: String, CodingKey {
        case accessToken = "AccessToken"
        case user = "User"
        case serverId = "ServerId"
        case sessionInfo = "SessionInfo"
    }
}

public struct AuthUser: Codable, Hashable, Sendable {
    public let id: String
    public let name: String?
    public let serverId: String?

    public enum CodingKeys: String, CodingKey {
        case id = "Id"
        case name = "Name"
        case serverId = "ServerId"
    }
}

public struct SessionInfo: Codable, Hashable, Sendable {
    public let id: String?
    public let userId: String?
    public let userName: String?
    public let client: String?

    public enum CodingKeys: String, CodingKey {
        case id = "Id"
        case userId = "UserId"
        case userName = "UserName"
        case client = "Client"
    }
}

struct ItemsEnvelope<T: Codable & Sendable>: Codable, Sendable {
    let items: [T]?
    let totalRecordCount: Int?

    enum CodingKeys: String, CodingKey {
        case items = "Items"
        case totalRecordCount = "TotalRecordCount"
    }
}

struct PlaybackInfoResponse: Codable, Sendable {
    let mediaSources: [MediaSource]?
    let playSessionId: String?

    enum CodingKeys: String, CodingKey {
        case mediaSources = "MediaSources"
        case playSessionId = "PlaySessionId"
    }
}
