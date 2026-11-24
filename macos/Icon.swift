import AppKit

// AGYScope app icon: obsidian rounded tile with the soaring Antigravity mark in the Gemini prismatic gradient.
let folder = CommandLine.arguments[1]

func agyPath(in rect: NSRect) -> NSBezierPath {
    let sx = rect.width / 24.0
    let sy = rect.height / 24.0
    func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
        NSPoint(x: rect.minX + x * sx, y: rect.minY + (24.0 - y) * sy)
    }
    let p = NSBezierPath()
    p.move(to: pt(19.94, 20.59))
    p.curve(to: pt(21.17, 19.36), controlPoint1: pt(21.03, 21.41), controlPoint2: pt(22.67, 20.86))
    p.curve(to: pt(12.03, 3.0), controlPoint1: pt(16.67, 15.0), controlPoint2: pt(17.62, 3.0))
    p.curve(to: pt(2.89, 19.36), controlPoint1: pt(6.44, 3.0), controlPoint2: pt(7.39, 15.0))
    p.curve(to: pt(4.12, 20.59), controlPoint1: pt(1.25, 21.0), controlPoint2: pt(3.03, 21.41))
    p.curve(to: pt(12.03, 12.68), controlPoint1: pt(8.35, 17.73), controlPoint2: pt(8.07, 12.68))
    p.curve(to: pt(19.94, 20.59), controlPoint1: pt(15.99, 12.68), controlPoint2: pt(15.71, 17.73))
    p.close()
    return p
}

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixels,
            pixelsHigh: pixels,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        )!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let p = CGFloat(pixels)
        let tile = NSBezierPath(
            roundedRect: NSRect(x: p * 0.05, y: p * 0.05, width: p * 0.9, height: p * 0.9),
            xRadius: p * 0.21,
            yRadius: p * 0.21
        )
        let bgGrad = NSGradient(
            starting: NSColor(red: 0.09, green: 0.10, blue: 0.13, alpha: 1),
            ending: NSColor(red: 0.14, green: 0.15, blue: 0.20, alpha: 1)
        )!
        bgGrad.draw(in: tile, angle: 120)

        let markRect = NSRect(x: p * 0.21, y: p * 0.20, width: p * 0.58, height: p * 0.58)
        let mark = agyPath(in: markRect)
        let prism = NSGradient(colors: [
            NSColor(red: 0.38, green: 0.65, blue: 0.98, alpha: 1),
            NSColor(red: 0.65, green: 0.55, blue: 0.98, alpha: 1),
            NSColor(red: 0.20, green: 0.83, blue: 0.60, alpha: 1),
        ])!
        prism.draw(in: mark, angle: 35)

        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(
            to: URL(fileURLWithPath: folder).appendingPathComponent("icon_\(size)x\(size)\(suffix).png")
        )
    }
}
