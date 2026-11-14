#!/usr/bin/env swift
// Draws the app's icon artwork, following Apple's app icon guidelines: flat shapes in
// layers, with no baked-in highlights, shadows or glass. The system adds those itself.
//
//   swift apps/apple/Resources/make-icons.swift
//
// iPhone/iPad: the Strata mark's three bands as SVG layers of AppIcon.icon (Icon
// Composer), each marked as glass; iOS renders the Liquid Glass. Apple TV: the layered
// icon (back: charcoal; front: the bands, which the TV lifts and moves for parallax) and
// both Top Shelf images, as PNGs in Assets.xcassets.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let resources = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let assets = resources.appendingPathComponent("Assets.xcassets")
let space = CGColorSpace(name: CGColorSpace.sRGB)!

/// The logo's colours, top band to bottom, and the charcoal behind them.
let tints: [UInt32] = [0xF7C873, 0xF39256, 0xD2603F]
let charcoal: (top: UInt32, bottom: UInt32) = (0x22252B, 0x0B0C0F)

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}
func hex(_ value: UInt32) -> String { String(format: "#%06X", value) }

/// The mark's bands (design units 460 × 500 from (300, 262)), scaled so the mark is
/// `height` tall and centred on `centre`, its play shape's visual centre a little left.
func bands(height: CGFloat, centre: CGPoint) -> [[CGPoint]] {
    let s = height / 500
    let origin = CGPoint(x: centre.x - 460 * s / 2 + 12 * s, y: centre.y - 500 * s / 2)
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: origin.x + (x - 300) * s, y: origin.y + (y - 262) * s) }
    return [
        [p(300, 262), p(552, 399), p(300, 399)],
        [p(300, 443), p(633, 443), p(760, 512), p(633, 581), p(300, 581)],
        [p(300, 625), p(552, 625), p(300, 762)],
    ]
}
/// The rounding on the bands' corners: a round-joined outline this wide, per design unit.
let cornerStroke: CGFloat = 16

// MARK: iPhone and iPad: SVG layers for AppIcon.icon

let markHeight: CGFloat = 600 // of the 1024 canvas
for (index, (points, tint)) in zip(bands(height: markHeight, centre: CGPoint(x: 512, y: 512)), tints).enumerated() {
    let name = ["band-top", "band-middle", "band-bottom"][index]
    let d = "M" + points.map { String(format: "%.1f %.1f", $0.x, $0.y) }.joined(separator: " L") + " Z"
    let svg = """
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <path d="\(d)" fill="\(hex(tint))" stroke="\(hex(tint))" stroke-width="\(String(format: "%.1f", cornerStroke * markHeight / 500))" stroke-linejoin="round"/>
    </svg>

    """
    try! svg.write(to: resources.appendingPathComponent("AppIcon.icon/Assets/\(name).svg"), atomically: true, encoding: .utf8)
    print("wrote AppIcon.icon/Assets/\(name).svg")
}

// MARK: Apple TV: PNG layers and Top Shelf

func render(_ width: Int, _ height: Int, to path: String, draw: (CGContext, CGSize) -> Void) {
    let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.translateBy(x: 0, y: CGFloat(height))
    ctx.scaleBy(x: 1, y: -1)
    draw(ctx, CGSize(width: width, height: height))
    let url = assets.appendingPathComponent(path)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
    precondition(CGImageDestinationFinalize(dest), "couldn't write \(path)")
    print("wrote \(path)")
}

/// A plain top-to-bottom charcoal: the background layer.
func background(_ ctx: CGContext, _ size: CGSize) {
    let gradient = CGGradient(colorsSpace: space, colors: [color(charcoal.top), color(charcoal.bottom)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
}

func fill(_ ctx: CGContext, _ points: [CGPoint], _ tint: UInt32, stroke: CGFloat) {
    let path = CGMutablePath()
    path.addLines(between: points); path.closeSubpath()
    ctx.addPath(path); ctx.setFillColor(color(tint)); ctx.fillPath()
    ctx.addPath(path); ctx.setStrokeColor(color(tint)); ctx.setLineWidth(stroke); ctx.setLineJoin(.round); ctx.strokePath()
}

let stack = "App Icon & Top Shelf Image.brandassets"
for (w, h, dir) in [(400, 240, "App Icon"), (800, 480, "App Icon"), (1280, 768, "App Icon - App Store")] {
    render(w, h, to: "\(stack)/\(dir).imagestack/Back.imagestacklayer/Content.imageset/back-\(w).png", draw: background)
    render(w, h, to: "\(stack)/\(dir).imagestack/Front.imagestacklayer/Content.imageset/front-\(w).png") { ctx, size in
        let height = size.height * 0.6
        for (points, tint) in zip(bands(height: height, centre: CGPoint(x: size.width / 2, y: size.height / 2)), tints) {
            fill(ctx, points, tint, stroke: cornerStroke * height / 500)
        }
    }
}

/// The Top Shelf: the mark's bands drawn out to the right edge in its colours, with two
/// faint bars framing them.
func topShelf(_ ctx: CGContext, _ size: CGSize) {
    background(ctx, size)
    let u = size.height / 720
    let right = size.width + 40 * u
    let bars: [(x: CGFloat, y: CGFloat, h: CGFloat, tint: CGColor)] = [
        (480, 40, 80, color(0xFFFFFF, 0.06)), (640, 144, 112, color(tints[0])), (880, 280, 144, color(tints[1])),
        (640, 448, 112, color(tints[2])), (480, 584, 128, color(0xFFFFFF, 0.06)),
    ]
    for bar in bars {
        let rect = CGRect(x: right - (bar.x + 40) * u, y: bar.y * u, width: (bar.x + 40) * u, height: bar.h * u)
        ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 28 * u, cornerHeight: 28 * u, transform: nil))
        ctx.setFillColor(bar.tint); ctx.fillPath()
    }
}
render(1920, 720, to: "\(stack)/Top Shelf Image.imageset/top-shelf-1920.png", draw: topShelf)
render(3840, 1440, to: "\(stack)/Top Shelf Image.imageset/top-shelf-3840.png", draw: topShelf)
render(2320, 720, to: "\(stack)/Top Shelf Image Wide.imageset/top-shelf-wide-2320.png", draw: topShelf)
render(4640, 1440, to: "\(stack)/Top Shelf Image Wide.imageset/top-shelf-wide-4640.png", draw: topShelf)
