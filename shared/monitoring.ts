export interface CoverageGap {
  start: number;
  end: number;
}

export interface Coverage {
  firstReadingAt: number | null;
  lastReadingAt: number | null;
  thresholdMs: number;
  gapCount: number;
  gaps: CoverageGap[];
}

export type HealthKind = "healthy" | "idle" | "paused" | "warning";

export function monitoringHealth(
  coverage: Coverage,
  collector: { enabled: boolean; lastError: string | null },
  tap: { installed: boolean },
  now: number,
  unreachable = false,
  cli: { enabled: boolean; state: string; available: boolean } | null = null,
  demo = false,
): { kind: HealthKind; label: string } {
  if (unreachable) return { kind: "warning", label: "Service unreachable" };
  if (demo)
    return {
      kind: "healthy",
      label: "Synthetic demo mode · local sample data",
    };
  if (!collector.enabled) return { kind: "paused", label: "Monitoring paused" };
  if (cli?.enabled && cli.available) {
    if (cli.state === "signed-out")
      return {
        kind: "warning",
        label: "CLI reads paused · Antigravity CLI is not signed in",
      };
    if (cli.state === "stopped")
      return {
        kind: "warning",
        label: "CLI reads stopped · they would have cost model tokens",
      };
    if (cli.state === "rate-limited")
      return {
        kind: "warning",
        label: "CLI reads rate limited · retrying",
      };
    if (
      coverage.lastReadingAt !== null &&
      now - coverage.lastReadingAt <= coverage.thresholdMs
    )
      return {
        kind: "healthy",
        label: "Monitoring healthy · Antigravity telemetry live",
      };
  }
  if (
    coverage.lastReadingAt !== null &&
    now - coverage.lastReadingAt <= coverage.thresholdMs
  )
    return {
      kind: "healthy",
      label: "Monitoring healthy · live Antigravity readings",
    };
  if (collector.lastError)
    return { kind: "warning", label: "Collection incomplete · retrying" };
  if (!tap.installed && (!cli || !cli.available))
    return {
      kind: "idle",
      label:
        "Transcripts live · install agy CLI & statusLine tap for live quota %",
    };
  if (coverage.lastReadingAt === null)
    return { kind: "idle", label: "Waiting for the first Antigravity reading" };
  return {
    kind: "idle",
    label: "Idle · no active Antigravity CLI session reporting",
  };
}
