import SwiftUI

/// Four-state load result for a screen's primary content. Replaces the
/// `item: T?` + `isLoading: Bool` pairs that couldn't represent failure, so a
/// network error is no longer indistinguishable from "still loading" or "empty".
public enum Loadable<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(String)

    public var value: Value? {
        if case .loaded(let v) = self { return v }
        return nil
    }

    public var isLoading: Bool {
        switch self {
        case .idle, .loading: return true
        default: return false
        }
    }

    public var errorMessage: String? {
        if case .failed(let m) = self { return m }
        return nil
    }
}

/// Renders the right thing for a `Loadable`: a spinner while loading, a
/// retryable error panel on failure, and the supplied content once loaded.
public struct AsyncContent<Value, Content: View>: View {
    private let state: Loadable<Value>
    private let retry: () -> Void
    private let content: (Value) -> Content

    public init(
        _ state: Loadable<Value>,
        retry: @escaping () -> Void,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.state = state
        self.retry = retry
        self.content = content
    }

    public var body: some View {
        switch state {
        case .idle, .loading:
            ProgressView()
                .tint(Strata.Tokens.paper)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ErrorRetryView(message: message, retry: retry)
        case .loaded(let value):
            content(value)
        }
    }
}

/// Editorial error state with a retry affordance. Used wherever a load can
/// fail so the user gets an explanation and a way out instead of a blank wait.
public struct ErrorRetryView: View {
    private let message: String
    private let retry: () -> Void

    public init(message: String, retry: @escaping () -> Void) {
        self.message = message
        self.retry = retry
    }

    public var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Strata.Tokens.paperDim)
            VStack(spacing: 6) {
                Text("Couldn't load")
                    .font(.fraunces(22, opticalSize: 40, soft: 40))
                    .foregroundStyle(Strata.Tokens.paper)
                Text(message)
                    .font(.plex(13))
                    .foregroundStyle(Strata.Tokens.paperDim)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .frame(maxWidth: 360)
            }
            SecondaryButton("Try Again", systemImage: "arrow.clockwise", action: retry)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
