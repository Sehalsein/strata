#if canImport(WidgetKit) && os(iOS)
import WidgetKit
import SwiftUI

@main
struct StrataWidgetsBundle: WidgetBundle {
    var body: some Widget {
        StrataNowPlayingActivity()
    }
}
#endif
