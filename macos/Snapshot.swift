import AppKit
import SwiftUI
import WebKit

// Offscreen Retina renderer for AGYScope's menu bar states, Mission Control popover,
// and Prismatic Obsidian web observatory (synthetic demo data only).

@MainActor
func renderPanelImage(model: PanelModel, dark: Bool) throws -> NSImage {
    let size = NSSize(width: 440, height: 645)
    let hosting = NSHostingView(rootView: PanelView(model: model, openDashboard: {}, quit: {}))
    hosting.sizingOptions = []
    hosting.frame = NSRect(origin: .zero, size: size)
    hosting.wantsLayer = true
    hosting.layer?.cornerRadius = 16
    hosting.layer?.masksToBounds = true
    let window = NSWindow(
        contentRect: NSRect(origin: NSPoint(x: -6000, y: -6000), size: size),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
    )
    window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.contentView = hosting
    window.orderFront(nil)
    hosting.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(size.width * 2),
        pixelsHigh: Int(size.height * 2),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    rep.size = size
    hosting.cacheDisplay(in: hosting.bounds, to: rep)
    window.orderOut(nil)
    let img = NSImage(size: size)
    img.addRepresentation(rep)
    return img
}

@MainActor
func settle(_ seconds: Double) {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
}

/// Draw a template NSImage tinted with a specific NSColor (simulating macOS dark/light menu bar tinting).
func tinted(_ image: NSImage, color: NSColor) -> NSImage {
    guard image.isTemplate else { return image }
    let out = NSImage(size: image.size)
    out.lockFocus()
    image.draw(in: NSRect(origin: .zero, size: image.size), from: .zero, operation: .sourceOver, fraction: 1)
    color.set()
    NSRect(origin: .zero, size: image.size).fill(using: .sourceAtop)
    out.unlockFocus()
    return out
}

/// Renders a crisp 2x showcase of all 4 Living Antigravity Logo menu bar states.
func writeMenuBarShowcase(to url: URL) throws {
    let clock = Date()
    let baseStatus = Status(
        version: 1,
        csrf: "demo",
        demo: true,
        windows: [],
        collector: MonitorState(enabled: true, running: false, lastError: nil),
        tap: TapState(installed: true, present: true, latestAt: clock.timeIntervalSince1970 * 1000),
        activity: ActivityState(lastAt: clock.timeIntervalSince1970 * 1000, sinceReading: false),
        account: AccountInfo(planTier: "Ultra", useG1Credits: true, creditsActive: false, cli: nil),
        window5h: nil,
        attempts: []
    )
    func win(_ slot: String, _ used: Double, credits: Bool = false) -> Allowance {
        Allowance(
            account: "demo",
            bucket: "antigravity",
            slot: slot,
            used: used,
            duration: slot == "five_hour" ? 300 : 10080,
            reset: clock.timeIntervalSince1970 + 7200,
            at: clock.timeIntervalSince1970 * 1000,
            source: "demo",
            planTier: "Ultra",
            creditsActive: credits,
            flags: []
        )
    }

    let items: [(title: String, subtitle: String, state: MenuBarState)] = [
        ("Healthy", "Native monochrome", MenuBarState(status: baseStatus, fiveHour: win("five_hour", 18), weekly: win("seven_day", 36), unavailable: false, now: clock)),
        ("Low 5h (<15%)", "Soft amber tint", MenuBarState(status: baseStatus, fiveHour: win("five_hour", 88), weekly: win("seven_day", 36), unavailable: false, now: clock)),
        ("AI Credits", "Violet + fallback", MenuBarState(status: baseStatus, fiveHour: win("five_hour", 100, credits: true), weekly: win("seven_day", 36), unavailable: false, now: clock)),
        ("Weekly Cap", "Coral cap alert", MenuBarState(status: baseStatus, fiveHour: win("five_hour", 100), weekly: win("seven_day", 100), unavailable: false, now: clock)),
    ]

    let w: CGFloat = 920
    let h: CGFloat = 210
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(w * 2),
        pixelsHigh: Int(h * 2),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    rep.size = NSSize(width: w, height: h)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    // Obsidian stage background
    let bgRect = NSRect(x: 0, y: 0, width: w, height: h)
    let bgPath = NSBezierPath(roundedRect: bgRect, xRadius: 18, yRadius: 18)
    NSGradient(
        starting: NSColor(red: 0.075, green: 0.08, blue: 0.10, alpha: 1),
        ending: NSColor(red: 0.10, green: 0.105, blue: 0.135, alpha: 1)
    )!.draw(in: bgPath, angle: 120)
    NSColor(white: 1, alpha: 0.09).setStroke()
    bgPath.lineWidth = 1.2
    bgPath.stroke()

    let header = NSAttributedString(
        string: "LIVING ANTIGRAVITY LOGO · MACOS MENU BAR STATES (SYNTHETIC)",
        attributes: [
            .font: NSFont.systemFont(ofSize: 10.5, weight: .semibold),
            .foregroundColor: NSColor(red: 0.58, green: 0.60, blue: 0.66, alpha: 1),
            .kern: 1.4,
        ]
    )
    header.draw(at: NSPoint(x: 28, y: h - 34))

    let cardW: CGFloat = 204
    let cardH: CGFloat = 134
    let gap: CGFloat = 16
    let startX: CGFloat = 28
    let startY: CGFloat = 26

    for (idx, item) in items.enumerated() {
        let x = startX + CGFloat(idx) * (cardW + gap)
        let cardRect = NSRect(x: x, y: startY, width: cardW, height: cardH)
        let cardPath = NSBezierPath(roundedRect: cardRect, xRadius: 13, yRadius: 13)
        NSColor(red: 0.11, green: 0.115, blue: 0.14, alpha: 1).setFill()
        cardPath.fill()
        NSColor(white: 1, alpha: 0.08).setStroke()
        cardPath.lineWidth = 1
        cardPath.stroke()

        // Simulated macOS dark menu bar strip inside card
        let barRect = NSRect(x: x + 14, y: startY + 56, width: cardW - 28, height: 60)
        let barPath = NSBezierPath(roundedRect: barRect, xRadius: 10, yRadius: 10)
        NSGradient(
            starting: NSColor(red: 0.16, green: 0.17, blue: 0.195, alpha: 1),
            ending: NSColor(red: 0.12, green: 0.125, blue: 0.145, alpha: 1)
        )!.draw(in: barPath, angle: -90)
        NSColor(white: 1, alpha: 0.11).setStroke()
        barPath.lineWidth = 0.8
        barPath.stroke()

        let rawGauge = MenuBarGauge.image(state: item.state, darkBar: true)
        let rendered = tinted(rawGauge, color: NSColor(white: 0.96, alpha: 1))
        let scale: CGFloat = 2.05
        let gw = rendered.size.width * scale
        let gh = rendered.size.height * scale
        rendered.draw(
            in: NSRect(x: barRect.midX - gw / 2, y: barRect.midY - gh / 2, width: gw, height: gh),
            from: .zero,
            operation: .sourceOver,
            fraction: 1
        )

        let tAttr = NSAttributedString(
            string: item.title,
            attributes: [
                .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
                .foregroundColor: NSColor(white: 0.95, alpha: 1),
            ]
        )
        let sAttr = NSAttributedString(
            string: item.subtitle,
            attributes: [
                .font: NSFont.systemFont(ofSize: 11, weight: .regular),
                .foregroundColor: NSColor(red: 0.58, green: 0.60, blue: 0.66, alpha: 1),
            ]
        )
        tAttr.draw(at: NSPoint(x: x + 16, y: startY + 29))
        sAttr.draw(at: NSPoint(x: x + 16, y: startY + 12))
    }

    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { throw MonitorError.response }
    try png.write(to: url)
}

/// Composites Dark and Light Mission Control popovers side-by-side on a clean stage.
func writePopoverShowcase(dark: NSImage, light: NSImage, to url: URL) throws {
    let w: CGFloat = 960
    let h: CGFloat = 710
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(w * 2),
        pixelsHigh: Int(h * 2),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    rep.size = NSSize(width: w, height: h)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    let bg = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: w, height: h), xRadius: 20, yRadius: 20)
    NSGradient(
        starting: NSColor(red: 0.08, green: 0.085, blue: 0.11, alpha: 1),
        ending: NSColor(red: 0.115, green: 0.12, blue: 0.16, alpha: 1)
    )!.draw(in: bg, angle: 135)

    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.45)
    shadow.shadowBlurRadius = 24
    shadow.shadowOffset = NSSize(width: 0, height: -10)

    let panelW: CGFloat = 440
    let panelH: CGFloat = 645
    let y: CGFloat = (h - panelH) / 2

    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    dark.draw(in: NSRect(x: 28, y: y, width: panelW, height: panelH), from: .zero, operation: .sourceOver, fraction: 1)
    light.draw(in: NSRect(x: 492, y: y, width: panelW, height: panelH), from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()

    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { throw MonitorError.response }
    try png.write(to: url)
}

final class WebSnapshotDelegate: NSObject, WKNavigationDelegate {
    var onFinish: (() -> Void)?
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onFinish?()
    }
}

/// Captures the real built React web dashboard at 2x Retina via native WKWebView.
@MainActor
func writeDashboardSnapshot(url: URL, to fileURL: URL) async throws {
    let size = NSSize(width: 1280, height: 1250)
    let config = WKWebViewConfiguration()
    let tzScript = WKUserScript(
        source: "localStorage.setItem('agy-timezone','UTC'); localStorage.setItem('agy-theme','dark');",
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )
    config.userContentController.addUserScript(tzScript)
    let webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
    let window = NSWindow(
        contentRect: NSRect(origin: NSPoint(x: -6000, y: -6000), size: size),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
    )
    window.appearance = NSAppearance(named: .darkAqua)
    window.contentView = webView
    window.orderFront(nil)

    let navDelegate = WebSnapshotDelegate()
    webView.navigationDelegate = navDelegate
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
        navDelegate.onFinish = { cont.resume() }
        webView.load(URLRequest(url: url))
    }
    // Wait for React fetch & chart render to settle cleanly
    settle(1.6)

    let snapConfig = WKSnapshotConfiguration()
    snapConfig.rect = NSRect(origin: .zero, size: size)
    snapConfig.snapshotWidth = NSNumber(value: Int(size.width))
    let image = try await webView.takeSnapshot(configuration: snapConfig)
    window.orderOut(nil)

    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        throw MonitorError.response
    }
    try png.write(to: fileURL)
}

@main
struct Snapshot {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        Task { @MainActor in
            do {
                try await run()
            } catch {
                fputs("snapshot failed: \(error)\n", stderr)
                exit(1)
            }
            exit(0)
        }
        app.run()
    }

    @MainActor
    static func run() async throws {
        let args = CommandLine.arguments
        guard args.count >= 2 else {
            fputs("usage: snapshot <output folder> [port]\n", stderr)
            exit(2)
        }
        let folder = URL(fileURLWithPath: args[1])
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let port = args.count > 2 ? Int(args[2]) ?? 4337 : 4337
        let base = try monitorURL(port: port)

        // 1. Menu bar Living Logo states showcase
        let barFile = folder.appendingPathComponent("menubar-states.png")
        try writeMenuBarShowcase(to: barFile)
        print("wrote \(barFile.path)")

        // 2. Mission Control Popover (Dark + Light side-by-side)
        let model = PanelModel(client: MonitorClient(base: base))
        await model.update()
        await model.updateHistory(force: true)
        settle(1.0)
        let darkPanel = try renderPanelImage(model: model, dark: true)
        settle(0.2)
        let lightPanel = try renderPanelImage(model: model, dark: false)
        settle(0.2)
        let popoverFile = folder.appendingPathComponent("popover-showcase.png")
        try writePopoverShowcase(dark: darkPanel, light: lightPanel, to: popoverFile)
        print("wrote \(popoverFile.path)")

        // 3. Prismatic Obsidian Web Dashboard
        let dashFile = folder.appendingPathComponent("dashboard.png")
        try await writeDashboardSnapshot(url: base, to: dashFile)
        print("wrote \(dashFile.path)")
    }
}
