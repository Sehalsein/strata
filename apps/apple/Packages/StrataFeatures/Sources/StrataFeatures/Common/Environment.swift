import SwiftUI
import StrataKit
import StrataPlayerUI

@MainActor
@Observable
public final class AppServices {
    public let auth: AuthStore
    public var engine: PlayerEngine
    public var nowPlaying: NowPlayingBridge?
    public let coordinator: AppCoordinator

    public init(auth: AuthStore) {
        self.auth = auth
        self.engine = PlayerEngine()
        self.coordinator = AppCoordinator()
        if let session = auth.session {
            let images = ImageURLBuilder(session: session)
            let np = NowPlayingBridge(images: images)
            self.nowPlaying = np
            engine.configure(client: JellyfinClient(session: session), nowPlaying: np)
            RemoteCommandBridge.shared.attach(engine)
        }
    }

    public func refreshSessionDependentServices() {
        if let session = auth.session {
            let images = ImageURLBuilder(session: session)
            let np = NowPlayingBridge(images: images)
            self.nowPlaying = np
            engine.configure(client: JellyfinClient(session: session), nowPlaying: np)
            RemoteCommandBridge.shared.attach(engine)
        } else {
            nowPlaying = nil
        }
    }

    public var client: JellyfinClient? {
        auth.session.map { JellyfinClient(session: $0) }
    }

    public var images: ImageURLBuilder? {
        auth.session.map { ImageURLBuilder(session: $0) }
    }
}
