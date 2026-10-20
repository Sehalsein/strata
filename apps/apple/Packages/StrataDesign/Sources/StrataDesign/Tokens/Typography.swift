import SwiftUI

/// The type scale, mapped onto Dynamic Type text styles (SF Pro everywhere,
/// SF Mono only for specs and timecodes). tvOS gets the platform's larger sizes
/// for the same styles automatically.
public extension Font {
    /// tvOS hero title. Fixed size by design.
    static let stDisplayTV = Font.system(size: 76, weight: .bold)
    /// Detail-page title.
    static let stDisplay = Font.largeTitle.bold()
    /// Screen title.
    static let stTitle1 = Font.title.bold()
    /// Rail headers on iPad/tvOS, sheet titles.
    static let stTitle2 = Font.title2.weight(.semibold)
    /// Rail headers on iPhone, row titles, buttons.
    static let stHeadline = Font.headline
    static let stBody = Font.body
    /// Metadata rows.
    static let stCallout = Font.callout
    static let stFootnote = Font.footnote
    /// Small uppercase label; pair with `.eyebrowStyle()`.
    static let stEyebrow = Font.caption.weight(.semibold)
    static let stSpec = Font.system(.caption2, design: .monospaced).weight(.semibold)
    static let stTimecode = Font.system(.footnote, design: .monospaced).weight(.medium).monospacedDigit()
}

public extension View {
    /// Tight tracking for display titles.
    func titleTracking() -> some View { tracking(-0.4) }

    /// Uppercase eyebrow label in `ink-3`.
    func eyebrowStyle(_ color: Color = Theme.ink3) -> some View {
        font(.stEyebrow).textCase(.uppercase).tracking(1).foregroundStyle(color)
    }

    /// The rail header style for the current platform.
    @ViewBuilder func railHeaderStyle() -> some View {
        #if os(tvOS)
        font(.stTitle2).foregroundStyle(Theme.ink)
        #else
        font(Metrics.isPad ? .stTitle2 : .stHeadline).foregroundStyle(Theme.ink)
        #endif
    }
}
