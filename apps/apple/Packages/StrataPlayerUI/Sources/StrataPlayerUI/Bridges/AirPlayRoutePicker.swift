import SwiftUI
import AVKit

/// Conditional AirPlay button. On iOS we wrap `AVRoutePickerView`; on macOS
/// we surface a styled `AVRoutePickerView` from AppKit. The button is always
/// present (sized to the layout slot) but visually no-ops if no route is
/// available — matches the web client's behavior of only highlighting when
/// a receiver is detected.
public struct AirPlayRoutePicker: View {
    public init() {}

    public var body: some View {
        #if canImport(UIKit) && !targetEnvironment(macCatalyst) && !os(tvOS)
        AirPlayPickerRepresentable()
        #elseif canImport(AppKit)
        AirPlayPickerRepresentableMac()
        #else
        // tvOS handles AirPlay output natively via the system overlay; the
        // app doesn't ship a picker here.
        Color.clear
        #endif
    }
}

#if canImport(UIKit) && !targetEnvironment(macCatalyst) && !os(tvOS)
import UIKit
import StrataDesign

struct AirPlayPickerRepresentable: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let v = AVRoutePickerView()
        v.tintColor = UIColor.white.withAlphaComponent(0.85)
        v.activeTintColor = UIColor(red: 232/255, green: 51/255, blue: 31/255, alpha: 1)
        v.prioritizesVideoDevices = true
        return v
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
#endif

#if canImport(AppKit)
import AppKit

struct AirPlayPickerRepresentableMac: NSViewRepresentable {
    func makeNSView(context: Context) -> AVRoutePickerView {
        let v = AVRoutePickerView()
        v.isRoutePickerButtonBordered = false
        v.setRoutePickerButtonColor(NSColor.white.withAlphaComponent(0.85), for: .normal)
        v.setRoutePickerButtonColor(NSColor(red: 232/255, green: 51/255, blue: 31/255, alpha: 1), for: .active)
        return v
    }
    func updateNSView(_ nsView: AVRoutePickerView, context: Context) {}
}
#endif
