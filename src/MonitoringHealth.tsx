import React from "react";
import type { CliReads, CollectorState, ScanState, TapState } from "../shared/api";
import { monitoringHealth, type Coverage } from "../shared/monitoring";
import { date, elapsed } from "./time";

export function MonitoringHealth({
  coverage,
  collector,
  tap,
  cli,
  scan,
  demo,
  now,
  timezone,
  unreachable,
  busy,
  onRetry,
  onReconnect,
}: {
  coverage: Coverage;
  collector: CollectorState;
  tap: TapState;
  cli: CliReads;
  scan: ScanState | null;
  demo: boolean;
  now: number;
  timezone: string;
  unreachable: boolean;
  busy: boolean;
  onRetry: () => void;
  onReconnect: () => void;
}) {
  const health = monitoringHealth(
    coverage,
    collector,
    tap,
    now,
    unreachable,
    cli,
    demo,
  );
  return (
    <section className="card health-card" aria-label="Monitoring health">
      <div className="health-head">
        <div>
          <div className="health-title">
            <span className={`health-dot health-${health.kind}`} />
            <h3>{health.label}</h3>
          </div>
          <p className="subtle-note">
            {coverage.lastReadingAt !== null
              ? `Last quota reading: ${date(coverage.lastReadingAt, timezone)} · ${elapsed(coverage.lastReadingAt, now)}`
              : "No quota reading recorded yet."}
          </p>
        </div>
        <div className="health-actions">
          {unreachable ? (
            <button className="button" onClick={onReconnect} disabled={busy}>
              Reconnect
            </button>
          ) : (
            <button className="button" onClick={onRetry} disabled={busy || demo}>
              Refresh now
            </button>
          )}
        </div>
      </div>

      <div className="health-grid">
        <div>
          <span>Recording gaps (7d)</span>
          <strong>
            {coverage.gapCount === 0
              ? "No recorded gaps"
              : `${coverage.gapCount} ${coverage.gapCount === 1 ? "gap" : "gaps"}`}
          </strong>
        </div>
        <div>
          <span>Antigravity CLI (agy)</span>
          <strong>
            {demo
              ? "Synthetic demo"
              : !cli.enabled
                ? "Disabled"
                : cli.available
                  ? cli.state === "ok"
                    ? `Active (${cli.count} reads)`
                    : cli.state
                  : "Not found on PATH"}
          </strong>
        </div>
        <div>
          <span>StatusLine tap</span>
          <strong>
            {demo
              ? "Synthetic demo"
              : tap.installed
                ? "Installed"
                : "Not installed"}
          </strong>
        </div>
        <div>
          <span>Local transcripts</span>
          <strong>
            {scan
              ? `${scan.files} ${scan.files === 1 ? "session" : "sessions"} · ${elapsed(scan.at, now)}`
              : "Scanning…"}
          </strong>
        </div>
      </div>
    </section>
  );
}
