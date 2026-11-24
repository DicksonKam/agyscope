import Foundation
import Combine
import AppKit

struct Allowance: Decodable, Identifiable {
    let account: String?
    let bucket: String
    let slot: String
    let used: Double
    let duration: Double?
    let reset: Double?
    let at: Double
    let source: String?
    let planTier: String?
    let creditsActive: Bool?
    let flags: [String]?

    var id: String { "\(bucket)/\(slot)" }
    var key: String { "[\"\(bucket)\",\"\(slot)\"]" }
    var remaining: Double { min(100, max(0, 100 - used)) }

    var title: String {
        let name: String
        switch bucket {
        case "antigravity": name = "Gemini Models"
        case "gemini_pro": name = "Gemini Pro"
        case "gemini_argon": name = "Gemini 4 Argon"
        case "gemini_flash": name = "Gemini Flash"
        case "third_party": name = "Claude & GPT"
        default: name = bucket.replacingOccurrences(of: "_", with: " ").capitalized
        }
        if slot == "five_hour" { return "\(name) · 5 hours" }
        if slot == "seven_day" { return "\(name) · Weekly" }
        guard let minutes = duration, minutes > 0 else {
            return "\(name) · \(slot.replacingOccurrences(of: "_", with: " "))"
        }
        if minutes >= 1440 { return "\(name) · \(Int(minutes / 1440)) days" }
        if minutes >= 60 { return "\(name) · \(Int(minutes / 60)) hours" }
        return "\(name) · \(Int(minutes)) min"
    }

    func resetPassed(at now: Date) -> Bool {
        guard let reset else { return false }
        return !reset.isFinite || reset <= now.timeIntervalSince1970
    }
}

struct ReadAttempt: Decodable { let at: Double; let ok: Bool }
struct MonitorState: Decodable { let enabled: Bool; let running: Bool; let lastError: String? }
struct TapState: Decodable { let installed: Bool; let present: Bool; let latestAt: Double? }
struct ActivityState: Decodable { let lastAt: Double?; let sinceReading: Bool }
struct CliReads: Decodable { let enabled: Bool; let available: Bool; let state: String; let lastError: String? }
struct AccountInfo: Decodable { let planTier: String?; let useG1Credits: Bool?; let creditsActive: Bool; let cli: CliReads? }
struct WorkBucket: Decodable {
    let conversations: Int
    let responses: Int
    let subagents: Int
    let swarms: Int
    let browserRuns: Int
    let scheduledTasks: Int
    let artifacts: Int
    let lastAt: Double?
}

struct Status: Decodable {
    let version: Int
    let csrf: String
    let demo: Bool?
    let windows: [Allowance]
    let collector: MonitorState
    let tap: TapState
    let activity: ActivityState?
    let account: AccountInfo?
    let window5h: WorkBucket?
    let attempts: [ReadAttempt]

    var latestReading: Date? { tap.latestAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
    func isLive(at now: Date = Date()) -> Bool {
        guard let read = latestReading else { return false }
        let age = now.timeIntervalSince(read)
        return age >= -60 && age < 180
    }
}

struct ConnectionSettings: Decodable { let port: Int? }
struct AppConnection: Decodable { let settingsPath: String; let port: Int }
enum MonitorError: Error { case configuration, response, incompatible, refused(String) }
struct ServiceFailure: Decodable { let error: String? }

func monitorURL(port: Int) throws -> URL {
    guard (1024...65535).contains(port), let url = URL(string: "http://127.0.0.1:\(port)") else {
        throw MonitorError.configuration
    }
    return url
}

let defaultWindowID = "antigravity/five_hour"

enum MenuBarAlertKind: Equatable {
    case healthy, low5h, credits, weeklyCap, unavailable
}

struct MenuBarState: Equatable {
    let fiveHourTitle: String
    let fiveHourRemaining: Double?
    let weeklyTitle: String?
    let weeklyTag: String // "WK" or "+" when AI Credits are active
    let stale: Bool
    let alert: MenuBarAlertKind
    let detail: String

    var accessibilityLabel: String { "AGYScope — \(detail)" }

    init(status: Status?, fiveHour: Allowance?, weekly: Allowance?, unavailable: Bool, now: Date) {
        if unavailable {
            fiveHourTitle = "—"; fiveHourRemaining = nil; weeklyTitle = nil; weeklyTag = "WK"
            stale = false; alert = .unavailable; detail = "Monitor unavailable"
            return
        }
        guard let status else {
            fiveHourTitle = "—"; fiveHourRemaining = nil; weeklyTitle = nil; weeklyTag = "WK"
            stale = false; alert = .unavailable; detail = "Connecting to AGYScope"
            return
        }
        if !status.collector.enabled && status.demo != true {
            fiveHourTitle = "—"; fiveHourRemaining = nil; weeklyTitle = nil; weeklyTag = "WK"
            stale = false; alert = .unavailable; detail = "Monitoring paused"
            return
        }
        guard let fiveHour else {
            fiveHourTitle = "—"; fiveHourRemaining = nil; weeklyTitle = nil; weeklyTag = "WK"
            stale = false; alert = .unavailable; detail = "Waiting for first Antigravity quota reading"
            return
        }

        let r5 = fiveHour.remaining
        let rWk = weekly?.remaining
        let formatPct: (Double) -> String = { v in v > 0 && v < 1 ? "<1%" : "\(Int(v.rounded()))%" }

        fiveHourTitle = formatPct(r5)
        fiveHourRemaining = r5
        weeklyTitle = rWk.map(formatPct)

        let creditsActive = status.account?.creditsActive == true || fiveHour.creditsActive == true
        weeklyTag = creditsActive ? "+" : "WK"

        let passed5 = fiveHour.resetPassed(at: now)
        let isLive = status.isLive(at: now)
        stale = passed5 || (!isLive && status.activity?.sinceReading == true)

        let weeklyCapped = (rWk != nil && rWk! <= 0) || (fiveHour.flags?.contains("weekly-cap-active") == true)
        if weeklyCapped { alert = .weeklyCap }
        else if creditsActive { alert = .credits }
        else if r5 < 15 { alert = .low5h }
        else { alert = .healthy }

        var parts = ["5h: \(fiveHourTitle) remaining"]
        if let wt = weeklyTitle { parts.append("Weekly: \(wt) remaining") }
        if weeklyCapped { parts.append("Weekly cap reached") }
        else if creditsActive { parts.append("AI Credits active") }
        else if passed5 { parts.append("From before reset") }
        else if stale { parts.append("Activity since last reading") }
        detail = parts.joined(separator: " · ")
    }
}

/// Authentic soaring Antigravity vector silhouette (from 24x24 viewBox, mapped to AppKit bottom-up coordinates).
enum AntigravityShape {
    static func path(in rect: NSRect) -> NSBezierPath {
        let sx = rect.width / 24.0
        let sy = rect.height / 24.0
        func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
            NSPoint(x: rect.minX + x * sx, y: rect.minY + (24.0 - y) * sy)
        }
        let p = NSBezierPath()
        // M 19.94 20.59
        p.move(to: pt(19.94, 20.59))
        // c 1.09 .82, 2.73 .27, 1.23 -1.23 -> abs (21.03,21.41) (22.67,20.86) (21.17,19.36)
        p.curve(to: pt(21.17, 19.36), controlPoint1: pt(21.03, 21.41), controlPoint2: pt(22.67, 20.86))
        // C 16.67 15, 17.62 3, 12.03 3
        p.curve(to: pt(12.03, 3.0), controlPoint1: pt(16.67, 15.0), controlPoint2: pt(17.62, 3.0))
        // S 7.39 15, 2.89 19.36 -> reflection of (17.62,3) around (12.03,3) is (6.44,3)
        p.curve(to: pt(2.89, 19.36), controlPoint1: pt(6.44, 3.0), controlPoint2: pt(7.39, 15.0))
        // c -1.64 1.64, .14 2.05, 1.23 1.23 -> abs (1.25,21.0) (3.03,21.41) (4.12,20.59)
        p.curve(to: pt(4.12, 20.59), controlPoint1: pt(1.25, 21.0), controlPoint2: pt(3.03, 21.41))
        // c 4.23 -2.86, 3.95 -7.91, 7.91 -7.91 -> abs (8.35,17.73) (8.07,12.68) (12.03,12.68)
        p.curve(to: pt(12.03, 12.68), controlPoint1: pt(8.35, 17.73), controlPoint2: pt(8.07, 12.68))
        // s 3.68 5.05, 7.91 7.91 -> reflection of (8.07,12.68) around (12.03,12.68) is (15.99,12.68); ctrl2=(15.71,17.73)
        p.curve(to: pt(19.94, 20.59), controlPoint1: pt(15.99, 12.68), controlPoint2: pt(15.71, 17.73))
        p.close()
        return p
    }
}

/// Living Antigravity Logo (Soft Ghost Fill) + bold 5h% + quiet stacked WK/% with Semantic Alert Tints.
enum MenuBarGauge {
    static func width(hasWeekly: Bool) -> CGFloat { hasWeekly ? 72 : 52 }

    static func image(state: MenuBarState, darkBar: Bool = true) -> NSImage {
        let hasWeekly = state.weeklyTitle != nil
        let size = NSSize(width: width(hasWeekly: hasWeekly), height: 22)
        let useTemplate = state.alert == .healthy || state.alert == .unavailable

        let primaryColor: NSColor
        let secondaryColor: NSColor
        switch state.alert {
        case .healthy, .unavailable:
            primaryColor = NSColor.black
            secondaryColor = NSColor.black
        case .low5h:
            primaryColor = darkBar
                ? NSColor(red: 0.98, green: 0.75, blue: 0.14, alpha: 1) // #fbbf24
                : NSColor(red: 0.85, green: 0.47, blue: 0.02, alpha: 1) // #d97706
            secondaryColor = darkBar ? NSColor.white : NSColor.black
        case .credits:
            primaryColor = darkBar
                ? NSColor(red: 0.65, green: 0.55, blue: 0.98, alpha: 1) // #a78bfa
                : NSColor(red: 0.49, green: 0.23, blue: 0.93, alpha: 1) // #7c3aed
            secondaryColor = primaryColor
        case .weeklyCap:
            primaryColor = darkBar
                ? NSColor(red: 0.97, green: 0.44, blue: 0.44, alpha: 1) // #f87171
                : NSColor(red: 0.86, green: 0.15, blue: 0.15, alpha: 1) // #dc2626
            secondaryColor = primaryColor
        }

        let dimAlpha: CGFloat = state.stale ? 0.55 : 1.0
        let image = NSImage(size: size, flipped: false) { _ in
            // 1. Living Antigravity Logo (Soft Ghost Fill, bottom-to-top by 5h remaining %)
            let logoRect = NSRect(x: 1.0, y: 2.2, width: 17.5, height: 17.5)
            let silhouette = AntigravityShape.path(in: logoRect)
            primaryColor.withAlphaComponent(0.24 * dimAlpha).setFill()
            silhouette.fill()

            if let rem = state.fiveHourRemaining, rem.isFinite, rem > 0 {
                NSGraphicsContext.saveGraphicsState()
                silhouette.addClip()
                let baseY = logoRect.minY + (3.0 / 24.0) * logoRect.height
                let spanH = (18.0 / 24.0) * logoRect.height
                let fillH = spanH * CGFloat(min(100, max(0, rem)) / 100.0)
                primaryColor.withAlphaComponent(dimAlpha).setFill()
                NSBezierPath.fill(NSRect(x: logoRect.minX, y: baseY - 1, width: logoRect.width, height: fillH + 1))
                NSGraphicsContext.restoreGraphicsState()
            }

            // 2. Bold hero 5-hour percentage
            let digits5 = state.fiveHourTitle.replacingOccurrences(of: "%", with: "")
            let font5Size: CGFloat = digits5.count >= 3 ? 10.2 : 12.2
            let text5 = NSMutableAttributedString(string: state.fiveHourTitle, attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: font5Size, weight: .bold),
                .foregroundColor: primaryColor.withAlphaComponent(dimAlpha),
            ])
            if state.fiveHourTitle.hasSuffix("%") {
                text5.addAttribute(.font, value: NSFont.systemFont(ofSize: 7.4, weight: .semibold), range: NSRange(location: (state.fiveHourTitle as NSString).length - 1, length: 1))
            }
            text5.draw(at: NSPoint(x: 20.5, y: 3.4))

            // 3. Quiet stacked Weekly (or + AI Credits) readout
            if let weeklyTitle = state.weeklyTitle {
                let tagAttr = NSAttributedString(string: state.weeklyTag, attributes: [
                    .font: NSFont.systemFont(ofSize: 5.8, weight: .semibold),
                    .foregroundColor: secondaryColor.withAlphaComponent((state.weeklyTag == "+" ? 0.92 : 0.48) * dimAlpha),
                ])
                let digitsW = weeklyTitle.replacingOccurrences(of: "%", with: "")
                let wkAttr = NSMutableAttributedString(string: weeklyTitle, attributes: [
                    .font: NSFont.monospacedDigitSystemFont(ofSize: digitsW.count >= 3 ? 7.2 : 8.2, weight: .medium),
                    .foregroundColor: secondaryColor.withAlphaComponent(0.70 * dimAlpha),
                ])
                if weeklyTitle.hasSuffix("%") {
                    wkAttr.addAttribute(.font, value: NSFont.systemFont(ofSize: 5.5, weight: .medium), range: NSRange(location: (weeklyTitle as NSString).length - 1, length: 1))
                }
                let centerX: CGFloat = 59.5
                tagAttr.draw(at: NSPoint(x: centerX - tagAttr.size().width / 2, y: 12.2))
                wkAttr.draw(at: NSPoint(x: centerX - wkAttr.size().width / 2, y: 2.2))
            }
            return true
        }
        image.isTemplate = useTemplate
        return image
    }
}

final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class MonitorClient {
    let base: URL
    let session: URLSession
    init(base: URL, session: URLSession? = nil) {
        self.base = base
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = session ?? URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }

    func read(refresh: Bool = false) async throws -> Status {
        let current = try await request(path: "/api/status")
        return refresh ? try await request(path: "/api/refresh", token: current.csrf) : current
    }

    func history(days: Int, window: Allowance?) async throws -> HistoryResponse {
        var url = URLComponents(url: base.appendingPathComponent("/api/state"), resolvingAgainstBaseURL: false)!
        url.queryItems = [
            URLQueryItem(name: "days", value: String(days == 0 ? 30 : days)),
            URLQueryItem(name: "historyScope", value: days == 0 ? "current" : "range"),
            URLQueryItem(name: "window", value: window?.key ?? ""),
            URLQueryItem(name: "timezone", value: TimeZone.current.identifier),
        ]
        let result: HistoryResponse = try await decodedRequest(url: url.url!)
        guard result.version == 1, result.history.count <= 600 else { throw MonitorError.incompatible }
        return result
    }

    private func request(path: String, token: String? = nil) async throws -> Status {
        let status: Status = try await decodedRequest(url: base.appendingPathComponent(path), token: token)
        guard status.version == 1, !status.csrf.isEmpty else { throw MonitorError.incompatible }
        return status
    }

    private func decodedRequest<T: Decodable>(url: URL, token: String? = nil) async throws -> T {
        var request = URLRequest(url: url)
        if let token {
            request.httpMethod = "POST"
            request.httpBody = Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(base.absoluteString, forHTTPHeaderField: "Origin")
            request.setValue(token, forHTTPHeaderField: "X-AGYScope-Token")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count < 2_000_000 else {
            throw MonitorError.response
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

final class HistorySelection: ObservableObject {
    @Published var inspected: PlotPoint?
}

@MainActor
final class PanelModel: ObservableObject {
    @Published private(set) var status: Status?
    @Published private(set) var busy = false
    @Published private(set) var unavailable = false
    @Published private(set) var history: HistoryResponse?
    @Published private(set) var historyBusy = false
    @Published private(set) var historyUnavailable = false
    let historySelection = HistorySelection()
    @Published var days = 30
    @Published var selectedWindow = defaultWindowID

    private var historyKey = ""
    private var historyGeneration = 0
    private var historyReadAt: Date?
    private let client: MonitorClient
    var dashboardURL: URL { client.base }

    init(client: MonitorClient) { self.client = client }

    var fiveHourWindow: Allowance? {
        let ws = status?.windows ?? []
        return ws.first { $0.id == "antigravity/five_hour" }
            ?? ws.first { $0.slot == "five_hour" }
            ?? ws.first { $0.slot.hasPrefix("five_hour_") }
    }

    var weeklyWindow: Allowance? {
        let ws = status?.windows ?? []
        return ws.first { $0.id == "antigravity/seven_day" }
            ?? ws.first { $0.slot == "seven_day" }
            ?? ws.first { $0.slot.hasPrefix("seven_day_") }
    }

    var window: Allowance? {
        status?.windows.first { $0.id == selectedWindow }
            ?? fiveHourWindow
            ?? status?.windows.first
    }

    func menuBarState(at now: Date = Date()) -> MenuBarState {
        MenuBarState(status: status, fiveHour: fiveHourWindow, weekly: weeklyWindow, unavailable: unavailable, now: now)
    }

    func poll(historyVisible: Bool) async {
        await update()
        if historyVisible { await updateHistory() }
    }

    func update(refresh: Bool = false) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let next = try await client.read(refresh: refresh)
            status = next
            unavailable = false
        } catch {
            unavailable = true
        }
    }

    func updateHistory(force: Bool = false) async {
        let selected = window
        let key = "\(days)/\(selected?.id ?? "")/\(TimeZone.current.identifier)"
        if !force && key == historyKey && (historyBusy || (historyReadAt.map { Date().timeIntervalSince($0) < 60 } ?? false)) { return }
        if key != historyKey { history = nil }
        historyKey = key
        historyGeneration += 1
        let gen = historyGeneration
        historyBusy = true
        do {
            let result = try await client.history(days: days, window: selected)
            guard gen == historyGeneration else { return }
            history = result
            historyUnavailable = false
            historyReadAt = Date()
        } catch {
            guard gen == historyGeneration else { return }
            historyUnavailable = true
        }
        historyBusy = false
    }

    func headline(at now: Date) -> String {
        if unavailable { return "Monitor unavailable" }
        guard let status else { return "Connecting to AGYScope…" }
        if status.demo == true { return "Synthetic demo · sample telemetry" }
        if !status.collector.enabled { return "Monitoring paused" }
        if status.account?.creditsActive == true { return "AI Credits fallback active" }
        if status.isLive(at: now) { return "Live · Antigravity telemetry active" }
        if let read = status.latestReading {
            if status.activity?.sinceReading == true {
                return "Activity since reading · read \(elapsed(since: read, at: now)) ago"
            }
            return "Last reading \(elapsed(since: read, at: now)) ago"
        }
        return "Transcripts live · awaiting quota tap"
    }
}
