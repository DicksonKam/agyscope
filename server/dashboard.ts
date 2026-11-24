import type {
  CycleInfo,
  DashboardDetails,
  DashboardQuery,
} from "../shared/api.ts";
import { selectPrimaryPair, sortWindows, windowKey } from "../shared/allowance.ts";
import { validTimezone } from "../shared/time.ts";
import type { Observation } from "../shared/types.ts";
import { coverage, queryHistory } from "./history-query.ts";
import type { Store } from "./store.ts";

export function dashboardQuery(params: URLSearchParams): DashboardQuery {
  const d = Number(params.get("days") ?? "30");
  const days: 7 | 30 | 90 = d === 7 ? 7 : d === 90 ? 90 : 30;
  const historyScope =
    params.get("historyScope") === "current" ? "current" : "range";
  const window = params.get("window") ?? "";
  const tz = params.get("timezone") ?? "UTC";
  return {
    days,
    historyScope,
    window,
    timezone: validTimezone(tz) ? tz : "UTC",
  };
}

export function inferCycle(
  latest: Observation | undefined,
  now = Date.now(),
): CycleInfo {
  if (!latest)
    return {
      available: false,
      from: null,
      reset: null,
      reason: "No quota reading recorded for this window yet.",
    };
  if (latest.reset === null || latest.duration === null || latest.duration <= 0)
    return {
      available: false,
      from: null,
      reset: latest.reset ? latest.reset * 1000 : null,
      reason:
        "Window timing unavailable; Antigravity did not report both reset time and duration.",
    };
  const resetMs = latest.reset * 1000;
  const from = resetMs - latest.duration * 60_000;
  if (resetMs <= now)
    return {
      available: true,
      from,
      reset: resetMs,
      reason: "Showing the last recorded window before its reset.",
    };
  return {
    available: true,
    from,
    reset: resetMs,
    reason: "",
  };
}

export function readDashboard(
  store: Store,
  query: DashboardQuery = {},
  now = Date.now(),
): DashboardDetails {
  const windows = sortWindows(store.latest());
  const { fiveHour } = selectPrimaryPair(windows);
  const latest =
    windows.find((w) => windowKey(w) === query.window) ??
    fiveHour ??
    windows[0];
  const cycle = inferCycle(latest, now);
  const days = query.days ?? 30;
  const scope = query.historyScope ?? "range";

  let history: Observation[] = [];
  let historyTruncated = false;
  if (latest) {
    const from =
      scope === "current" && cycle.available && cycle.from !== null
        ? cycle.from
        : now - days * 86_400_000;
    const result = queryHistory(store, latest, from, now);
    history = result.points;
    historyTruncated = result.truncated;
  }

  return {
    latest,
    cycle,
    history,
    historyTruncated,
    coverage: coverage(store, undefined, 20, now),
    totals: store.workSummary(),
    models: store.modelBreakdown(),
    surfaces: store.surfaceBreakdown(),
    tools: store.topTools(),
    recentConversations: store.recentConversations(),
    issues: store.issues(),
    query: {
      days,
      historyScope: scope,
      window: latest ? windowKey(latest) : "",
      timezone: query.timezone ?? "UTC",
    },
  };
}
