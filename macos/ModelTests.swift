import Foundation
import AppKit

func check(_ cond: Bool, _ msg: String) {
    if !cond {
        fputs("FAIL: \(msg)\n", stderr)
        exit(1)
    }
}

@main
struct AGYScopeModelTests {
    static func main() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let status = Status(
            version: 1,
            csrf: "tok",
            demo: false,
            windows: [
                Allowance(account: "a", bucket: "antigravity", slot: "five_hour", used: 18, duration: 300, reset: 1_800_007_200, at: 1_799_999_940_000, source: "statusline", planTier: "Pro", creditsActive: false, flags: []),
                Allowance(account: "a", bucket: "antigravity", slot: "seven_day", used: 36, duration: 10080, reset: 1_800_200_000, at: 1_799_999_940_000, source: "statusline", planTier: "Pro", creditsActive: false, flags: []),
            ],
            collector: MonitorState(enabled: true, running: false, lastError: nil),
            tap: TapState(installed: true, present: true, latestAt: 1_799_999_940_000),
            activity: ActivityState(lastAt: 1_799_999_900_000, sinceReading: false),
            account: AccountInfo(planTier: "Pro", useG1Credits: true, creditsActive: false, cli: nil),
            window5h: WorkBucket(conversations: 3, responses: 12, subagents: 2, swarms: 1, browserRuns: 1, scheduledTasks: 0, artifacts: 2, lastAt: 1_799_999_900_000),
            attempts: []
        )

        let healthy = MenuBarState(status: status, fiveHour: status.windows[0], weekly: status.windows[1], unavailable: false, now: now)
        check(healthy.fiveHourTitle == "82%", "expected 82%, got \(healthy.fiveHourTitle)")
        check(healthy.weeklyTitle == "64%", "expected 64%, got \(healthy.weeklyTitle ?? "nil")")
        check(healthy.alert == .healthy, "expected healthy alert")
        check(healthy.weeklyTag == "WK", "expected WK tag")
        let healthyImg = MenuBarGauge.image(state: healthy, darkBar: true)
        check(healthyImg.isTemplate == true, "healthy menu bar image must be a native template image")

        let low5hWin = Allowance(account: "a", bucket: "antigravity", slot: "five_hour", used: 88, duration: 300, reset: 1_800_007_200, at: 1_799_999_940_000, source: "statusline", planTier: "Pro", creditsActive: false, flags: [])
        let low = MenuBarState(status: status, fiveHour: low5hWin, weekly: status.windows[1], unavailable: false, now: now)
        check(low.alert == .low5h, "expected low5h alert at 12% remaining")
        let lowImg = MenuBarGauge.image(state: low, darkBar: true)
        check(lowImg.isTemplate == false, "alert menu bar image must carry semantic tint")

        let creditsWin = Allowance(account: "a", bucket: "antigravity", slot: "five_hour", used: 100, duration: 300, reset: 1_800_007_200, at: 1_799_999_940_000, source: "statusline", planTier: "Pro", creditsActive: true, flags: ["credits-fallback"])
        let credits = MenuBarState(status: status, fiveHour: creditsWin, weekly: status.windows[1], unavailable: false, now: now)
        check(credits.alert == .credits && credits.weeklyTag == "+", "expected violet AI Credits alert with + tag")

        let capWin = Allowance(account: "a", bucket: "antigravity", slot: "seven_day", used: 100, duration: 10080, reset: 1_800_200_000, at: 1_799_999_940_000, source: "statusline", planTier: "Pro", creditsActive: false, flags: [])
        let capped = MenuBarState(status: status, fiveHour: low5hWin, weekly: capWin, unavailable: false, now: now)
        check(capped.alert == .weeklyCap, "expected weeklyCap alert when weekly hits 0% remaining")

        let plot = allowancePlot([
            HistoryPoint(at: 1_000_000, used: 10, reset: 5000, chartSegment: 1),
            HistoryPoint(at: 1_060_000, used: 20, reset: 5000, chartSegment: 1),
            HistoryPoint(at: 3_000_000, used: 5, reset: 9000, chartSegment: 2),
        ])
        check(plot.count == 3 && plot[0].segment == 0 && plot[1].segment == 0 && plot[2].segment == 1, "chart gap/reset segmentation")

        let frame = panelFrame(anchor: CGRect(x: 1400, y: 880, width: 70, height: 22), visible: CGRect(x: 0, y: 0, width: 1440, height: 900))
        check(frame.maxX <= 1440 && frame.minX >= 0 && frame.minY >= 0, "panel stays clamped within display bounds")

        print("AGYScope macOS native model tests passed.")
    }
}
