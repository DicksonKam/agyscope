import AppKit
import SwiftUI
import Darwin
import Combine

/// SwiftUI rendering of the authentic Antigravity silhouette for the popover header.
struct AgyMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 24.0
        let sy = rect.height / 24.0
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var p = Path()
        p.move(to: pt(19.94, 20.59))
        p.addCurve(to: pt(21.17, 19.36), control1: pt(21.03, 21.41), control2: pt(22.67, 20.86))
        p.addCurve(to: pt(12.03, 3.0), control1: pt(16.67, 15.0), control2: pt(17.62, 3.0))
        p.addCurve(to: pt(2.89, 19.36), control1: pt(6.44, 3.0), control2: pt(7.39, 15.0))
        p.addCurve(to: pt(4.12, 20.59), control1: pt(1.25, 21.0), control2: pt(3.03, 21.41))
        p.addCurve(to: pt(12.03, 12.68), control1: pt(8.35, 17.73), control2: pt(8.07, 12.68))
        p.addCurve(to: pt(19.94, 20.59), control1: pt(15.99, 12.68), control2: pt(15.71, 17.73))
        p.closeSubpath()
        return p
    }
}

/// Prismatic Obsidian theme aligned with src/style.css in both dark and light appearances.
struct PanelTheme {
    let dark: Bool
    private func color(_ light: UInt32, _ darkValue: UInt32) -> Color {
        let value = dark ? darkValue : light
        return Color(
            red: Double((value >> 16) & 255) / 255,
            green: Double((value >> 8) & 255) / 255,
            blue: Double(value & 255) / 255
        )
    }
    var background: Color { color(0xf7f7f9, 0x131417) }
    var surface: Color { color(0xffffff, 0x1c1d22) }
    var raised: Color { color(0xf0f1f6, 0x24262e) }
    var ink: Color { color(0x181a20, 0xf3f4f6) }
    var muted: Color { color(0x64697a, 0x9498a6) }
    var line: Color { color(0xe5e7ee, 0x2c2e38) }
    var accent: Color { color(0x3b82f6, 0x60a5fa) }
    var violet: Color { color(0x7c3aed, 0xa78bfa) }
    var mint: Color { color(0x10b981, 0x34d399) }
    var amber: Color { color(0xd97706, 0xfbbf24) }
    var coral: Color { color(0xdc2626, 0xf87171) }

    var prismGradient: LinearGradient {
        LinearGradient(colors: [accent, violet, mint], startPoint: .leading, endPoint: .trailing)
    }
}

struct DashboardButtonStyle: ButtonStyle {
    let theme: PanelTheme
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .semibold))
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .foregroundStyle(theme.dark ? theme.background : Color.white)
            .background(theme.ink.opacity(configuration.isPressed ? 0.82 : 1), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct PanelView: View {
    @ObservedObject var model: PanelModel
    @Environment(\.colorScheme) private var scheme
    let openDashboard: () -> Void
    let quit: () -> Void

    private var theme: PanelTheme { PanelTheme(dark: scheme == .dark) }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            VStack(alignment: .leading, spacing: 11) {
                header
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        card { quotaCard(at: context.date) }
                        card { HistoryView(model: model, theme: theme, selection: model.historySelection) }
                        card { missionControlStrip }
                    }
                }
                .frame(maxHeight: .infinity)
                HStack {
                    Button(action: openDashboard) {
                        HStack {
                            Text("Open dashboard")
                            Spacer()
                            Image(systemName: "arrow.up.right")
                        }
                    }
                    .buttonStyle(DashboardButtonStyle(theme: theme))
                    Menu {
                        Text("Background monitoring continues while awake")
                        Button("Refresh now") { Task { await model.update(refresh: true); await model.updateHistory(force: true) } }
                        Divider()
                        Button("Quit menu bar app", action: quit)
                    } label: {
                        Image(systemName: "ellipsis")
                            .foregroundStyle(theme.muted)
                            .frame(width: 28, height: 32)
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .help("Menu bar options")
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .foregroundStyle(theme.ink)
            .tint(theme.accent)
            .background(theme.background)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            AgyMarkShape()
                .fill(theme.prismGradient)
                .frame(width: 16, height: 16)
                .frame(width: 26, height: 26)
                .background(theme.raised, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(theme.line))
            Text("AGYScope").font(.system(size: 13, weight: .semibold))
            if model.status?.demo == true {
                Text("DEMO")
                    .font(.system(size: 9.5, weight: .semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(theme.raised, in: Capsule())
                    .foregroundStyle(theme.muted)
            }
            Spacer()
            if model.busy || model.historyBusy { ProgressView().controlSize(.small) }
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(theme.line))
    }

    private func quotaCard(at now: Date) -> some View {
        let state = model.menuBarState(at: now)
        let active = model.window
        let weekly = model.weeklyWindow
        return VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(active?.title ?? "Antigravity · 5 hours").font(.system(size: 12.5, weight: .medium))
                Spacer()
                if let read = model.status?.latestReading {
                    Text("\(model.status?.isLive(at: now) == true ? "Live" : "Read") · \(elapsed(since: read, at: now)) ago")
                        .font(.system(size: 10.5))
                        .foregroundStyle(theme.muted)
                        .monospacedDigit()
                }
            }

            if let window = active {
                let passed = window.resetPassed(at: now)
                HStack(alignment: .center, spacing: 6) {
                    Text("\(window.remaining.formatted(.number.precision(.fractionLength(0...1))))%")
                        .font(.system(size: 32, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(state.stale ? theme.muted : theme.ink)
                    Text(passed ? "before reset" : "remaining")
                        .font(.system(size: 12.5))
                        .foregroundStyle(theme.muted)
                    Spacer(minLength: 8)
                    if let reset = window.reset {
                        let date = Date(timeIntervalSince1970: reset)
                        VStack(alignment: .trailing, spacing: 2) {
                            if date > now {
                                Text("Resets in \(remaining(until: date, at: now))")
                                    .font(.system(size: 12, weight: .medium))
                                    .monospacedDigit()
                                Text(date.formatted(date: .abbreviated, time: .shortened))
                                    .font(.system(size: 10.5))
                                    .foregroundStyle(theme.muted)
                            } else {
                                Text("Reset \(elapsed(since: date, at: now)) ago")
                                    .font(.system(size: 12, weight: .medium))
                                Text("Awaiting fresh reading")
                                    .font(.system(size: 10.5))
                                    .foregroundStyle(theme.muted)
                            }
                        }
                        .multilineTextAlignment(.trailing)
                    }
                }

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(theme.raised)
                        Capsule()
                            .fill(barFill(alert: state.alert))
                            .frame(width: max(4, geo.size.width * CGFloat(window.remaining / 100.0)))
                    }
                }
                .frame(height: 6)

                HStack {
                    if let weekly {
                        HStack(spacing: 3) {
                            Text("Weekly ceiling:")
                                .foregroundStyle(theme.muted)
                            Text("\(weekly.remaining.formatted(.number.precision(.fractionLength(0...1))))% left")
                                .fontWeight(.semibold)
                        }
                    } else {
                        Text("Weekly ceiling unavailable").foregroundStyle(theme.muted)
                    }
                    Spacer()
                    Text(creditsLabel).foregroundStyle(model.status?.account?.creditsActive == true ? theme.violet : theme.muted)
                }
                .font(.system(size: 11))
                .monospacedDigit()
            } else {
                Text(model.status == nil ? "Connecting to AGYScope…" : "No quota reading yet · transcripts are still tracked below")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.muted)
            }

            HStack(spacing: 7) {
                Circle().fill(dotColor(alert: state.alert)).frame(width: 7, height: 7)
                Text(model.headline(at: now)).font(.system(size: 11.5))
                Spacer()
            }

            let others = (model.status?.windows ?? []).filter { $0.id != active?.id }
            if !others.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(others) { other in
                            Button(action: { model.selectedWindow = other.id }) {
                                HStack(spacing: 4) {
                                    Text(other.title).font(.system(size: 10.5, weight: .medium))
                                    Text("\(other.remaining.formatted(.number.precision(.fractionLength(0))))%")
                                        .font(.system(size: 10.5))
                                        .monospacedDigit()
                                        .foregroundStyle(theme.muted)
                                }
                                .padding(.horizontal, 8)
                                .frame(minHeight: 22)
                                .background(theme.raised, in: Capsule())
                                .overlay(Capsule().strokeBorder(theme.line))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    /// P3 · Mission Control strip: live Antigravity activity in the current 5-hour window.
    private var missionControlStrip: some View {
        let w = model.status?.window5h
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("This 5h window").font(.system(size: 11.5, weight: .semibold))
                Spacer()
                if let last = w?.lastAt {
                    Text("Active \(elapsed(since: Date(timeIntervalSince1970: last / 1000), at: Date())) ago")
                        .font(.system(size: 10.5))
                        .foregroundStyle(theme.muted)
                }
            }
            if let w {
                HStack(spacing: 12) {
                    metricPill("\(w.conversations)", "convos")
                    metricPill("\(w.subagents + w.swarms)", "agents")
                    metricPill("\(w.browserRuns)", "browser")
                    metricPill("\(w.artifacts)", "artifacts")
                }
            } else {
                Text("Scanning local Antigravity transcripts…")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.muted)
            }
        }
    }

    private func metricPill(_ value: String, _ label: String) -> some View {
        HStack(spacing: 4) {
            Text(value).font(.system(size: 12, weight: .semibold)).monospacedDigit()
            Text(label).font(.system(size: 10.5)).foregroundStyle(theme.muted)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(theme.raised, in: RoundedRectangle(cornerRadius: 6))
    }

    private var creditsLabel: String {
        if model.status?.account?.creditsActive == true { return "AI Credits: Active" }
        if model.status?.account?.useG1Credits == true { return "AI Credits: Standby" }
        return "AI Credits: Off"
    }

    private func barFill(alert: MenuBarAlertKind) -> AnyShapeStyle {
        switch alert {
        case .weeklyCap: return AnyShapeStyle(theme.coral)
        case .credits: return AnyShapeStyle(theme.violet)
        case .low5h: return AnyShapeStyle(theme.amber)
        case .healthy, .unavailable: return AnyShapeStyle(theme.prismGradient)
        }
    }

    private func dotColor(alert: MenuBarAlertKind) -> Color {
        switch alert {
        case .healthy: return theme.mint
        case .low5h: return theme.amber
        case .credits: return theme.violet
        case .weeklyCap: return theme.coral
        case .unavailable: return theme.muted
        }
    }
}

final class HistoryPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var item: NSStatusItem!
    private let panel = HistoryPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    private var outsideClick: Any?
    private var localClick: Any?
    private var model: PanelModel!
    private var timer: Timer?
    private var statusChanges: AnyCancellable?
    private var displayedState: MenuBarState?
    private var displayedDark: Bool?
    private var lockFD: Int32 = -1

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            guard let resource = Bundle.main.url(forResource: "connection", withExtension: "json") else { throw MonitorError.configuration }
            let connection = try JSONDecoder().decode(AppConnection.self, from: Data(contentsOf: resource))
            let settingsURL = URL(fileURLWithPath: connection.settingsPath)
            let folder = settingsURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            lockFD = open(folder.appendingPathComponent("menu-bar.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
            guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { NSApp.terminate(nil); return }

            var port = connection.port
            if FileManager.default.fileExists(atPath: settingsURL.path) {
                port = try JSONDecoder().decode(ConnectionSettings.self, from: Data(contentsOf: settingsURL)).port ?? port
            }
            model = PanelModel(client: MonitorClient(base: try monitorURL(port: port)))
            NSApp.setActivationPolicy(.accessory)
            item = NSStatusBar.system.statusItem(withLength: MenuBarGauge.width(hasWeekly: true))
            if let button = item.button {
                button.imagePosition = .imageOnly
                button.target = self
                button.action = #selector(togglePanel)
            }
            updateMenuBar()
            statusChanges = model.objectWillChange.receive(on: RunLoop.main).sink { [weak self] _ in self?.updateMenuBar() }

            panel.title = "AGYScope"
            panel.isReleasedWhenClosed = false
            panel.level = .popUpMenu
            panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
            panel.hasShadow = true
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.delegate = self

            let hosting = NSHostingView(rootView: PanelView(model: model, openDashboard: { [weak self] in
                guard let self else { return }
                if NSWorkspace.shared.open(self.model.dashboardURL) {
                    self.panel.orderOut(nil)
                }
            }, quit: { NSApp.terminate(nil) }))
            hosting.sizingOptions = []
            hosting.wantsLayer = true
            hosting.layer?.cornerRadius = 16
            hosting.layer?.masksToBounds = true
            panel.contentView = hosting

            outsideClick = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in self?.panel.orderOut(nil) }
            localClick = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
                if let self, event.window != self.panel, event.window != self.item.button?.window { self.panel.orderOut(nil) }
                return event
            }
            NotificationCenter.default.addObserver(self, selector: #selector(screenChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
            NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(woke), name: NSWorkspace.didWakeNotification, object: nil)

            timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
                Task { @MainActor in await self?.poll() }
            }
            Task { await poll() }
        } catch {
            let alert = NSAlert()
            alert.messageText = "AGYScope needs setup"
            alert.informativeText = "The local connection settings could not be read. Reinstall the menu bar app from the AGYScope project."
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    private func isDarkMenuBar() -> Bool {
        let match = item?.button?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])
        return match == .darkAqua
    }

    private func updateMenuBar() {
        guard let button = item?.button else { return }
        let state = model.menuBarState()
        let dark = isDarkMenuBar()
        if displayedState != state || displayedDark != dark {
            item.length = MenuBarGauge.width(hasWeekly: state.weeklyTitle != nil)
            button.image = MenuBarGauge.image(state: state, darkBar: dark)
            displayedState = state
            displayedDark = dark
        }
        button.toolTip = "\(state.detail)\nClick for Mission Control & allowance history"
        button.setAccessibilityLabel(state.accessibilityLabel)
    }

    private func poll() async {
        updateMenuBar()
        await model.poll(historyVisible: panel.isVisible)
        updateMenuBar()
    }

    @objc private func woke() {
        updateMenuBar()
        Task { await poll() }
    }

    @objc private func screenChanged() { if panel.isVisible { positionPanel() } }

    private func positionPanel() {
        guard let button = item.button, let window = button.window, let screen = window.screen else { return }
        let anchor = window.convertToScreen(button.convert(button.bounds, to: nil))
        panel.setFrame(panelFrame(anchor: anchor, visible: screen.visibleFrame), display: true)
    }

    @objc private func togglePanel() {
        if panel.isVisible { panel.orderOut(nil); return }
        positionPanel()
        panel.makeKeyAndOrderFront(nil)
        Task { await model.update(); await model.updateHistory(force: true) }
    }

    func windowDidResignKey(_ notification: Notification) { panel.orderOut(nil) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { togglePanel(); return false }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        statusChanges?.cancel()
        if let outsideClick { NSEvent.removeMonitor(outsideClick) }
        if let localClick { NSEvent.removeMonitor(localClick) }
        NotificationCenter.default.removeObserver(self)
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        if lockFD >= 0 { close(lockFD) }
    }
}

#if !AGYSCOPE_SNAPSHOT
@main
struct AGYScopeApplication {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
#endif
