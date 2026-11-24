import React from "react";
import type { DashboardState } from "../shared/api";
import type { Observation } from "../shared/types";
import {
  selectPrimaryPair,
  windowKey,
  windowLabel,
} from "../shared/allowance";
import { liveMs, remainingPercent } from "../shared/history";
import { AgyMark } from "./AgyMark";
import { HistoryChart } from "./HistoryChart";
import { MonitoringHealth } from "./MonitoringHealth";
import { date, elapsed, resetCountdown } from "./time";

function fmtPct(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function QuotaRunway({
  data,
  now,
  timezone,
  unreachable,
  activitySince,
  selectedWindow,
  onSelectWindow,
  range,
  onSelectRange,
  busy,
  onRetry,
  onReconnect,
}: {
  data: DashboardState;
  now: number;
  timezone: string;
  unreachable: boolean;
  activitySince: boolean;
  selectedWindow: string;
  onSelectWindow: (key: string) => void;
  range: string;
  onSelectRange: (range: string) => void;
  busy: boolean;
  onRetry: () => void;
  onReconnect: () => void;
}) {
  const windows: Observation[] = data.windows;
  const { fiveHour, weekly } = selectPrimaryPair(windows);
  const selected =
    windows.find((w) => windowKey(w) === selectedWindow) ??
    fiveHour ??
    windows[0];

  const rem5 = fiveHour ? remainingPercent(fiveHour.used) : null;
  const remWk = weekly ? remainingPercent(weekly.used) : null;
  const expired5 = fiveHour?.reset !== null && fiveHour?.reset !== undefined && fiveHour.reset * 1000 <= now;
  const expiredWk = weekly?.reset !== null && weekly?.reset !== undefined && weekly.reset * 1000 <= now;
  const live5 = !!fiveHour && !unreachable && now - fiveHour.at <= liveMs;
  const stale5 = expired5 || (activitySince && !live5);

  const weeklyCapped =
    (remWk !== null && remWk <= 0) ||
    !!fiveHour?.flags.includes("weekly-cap-active");
  const creditsActive = data.account.creditsActive;
  const low5 = rem5 !== null && rem5 < 15 && !creditsActive && !weeklyCapped;

  const heroTint = weeklyCapped
    ? "#f87171"
    : creditsActive
      ? "#a78bfa"
      : low5
        ? "#fbbf24"
        : undefined;

  const historyReady =
    !!data.query &&
    data.query.days === (range === "current" ? 30 : Number(range)) &&
    (data.query.historyScope ?? "range") ===
      (range === "current" ? "current" : "range") &&
    data.query.window === (selected ? windowKey(selected) : "");

  const points = (historyReady ? (data.history ?? []) : []).map((p) => ({
    ...p,
    remaining: remainingPercent(p.used),
  }));

  return (
    <div className="page-stack">
      {!windows.length ? (
        <section className="card waiting-card">
          <div className="waiting-head">
            <AgyMark size={28} fillPercent={42} />
            <div>
              <h2>Waiting for your first Antigravity quota reading</h2>
              <p>
                Local Antigravity transcripts are already live under{" "}
                <strong>Agents &amp; Work</strong> (
                {data.window5h.conversations} recent conversations scanned). For
                live 5-hour &amp; weekly quota percentages, install the official{" "}
                <code>agy</code> CLI and run <code>npm run tap -- install</code>
                , or preview every state now with <code>npm run demo</code>.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="runway-grid" aria-label="Primary Antigravity limits">
          {/* Hero 5-Hour Rolling Window */}
          <article
            className={`card hero-card${stale5 ? " is-stale" : ""}${
              weeklyCapped
                ? " alert-coral"
                : creditsActive
                  ? " alert-violet"
                  : low5
                    ? " alert-amber"
                    : ""
            }`}
            onClick={() => fiveHour && onSelectWindow(windowKey(fiveHour))}
          >
            <div className="card-top">
              <div className="eyebrow-row">
                <AgyMark
                  size={20}
                  fillPercent={rem5 ?? 0}
                  prism={!heroTint}
                  tint={heroTint}
                />
                <span className="overline">5-HOUR ROLLING WINDOW</span>
              </div>
              <span className="pill-chip">
                {weeklyCapped
                  ? "Paused by weekly cap"
                  : creditsActive
                    ? "AI Credits active"
                    : expired5
                      ? "Before the reset"
                      : data.demo
                        ? "Synthetic demo"
                        : fiveHour?.source === "cli"
                          ? "Antigravity CLI"
                          : "StatusLine tap"}
              </span>
            </div>

            <div className="hero-metric">
              <strong className="hero-number">
                {rem5 !== null ? fmtPct(rem5) : "—"}
                <span>%</span>
              </strong>
              <div className="hero-meta">
                <span>
                  {expired5
                    ? "remaining before reset"
                    : weeklyCapped
                      ? "refills paused until weekly rollover"
                      : creditsActive
                        ? "base quota used · drawing AI Credits"
                        : "remaining in this 5h window"}
                </span>
                {fiveHour && (
                  <small>
                    {live5
                      ? `Live · ${elapsed(fiveHour.at, now)}`
                      : `Observed · ${elapsed(fiveHour.at, now)}`}
                  </small>
                )}
              </div>
            </div>

            <div className="meter-track hero-track">
              <div
                className={`meter-fill${heroTint ? "" : " prism-fill"}`}
                style={{
                  width: `${rem5 ?? 0}%`,
                  ...(heroTint ? { background: heroTint } : {}),
                }}
              />
            </div>

            <div className="card-footer">
              <strong>
                {fiveHour ? resetCountdown(fiveHour.reset, now) : "No reading"}
              </strong>
              {fiveHour?.reset !== null && fiveHour?.reset !== undefined && (
                <time dateTime={new Date(fiveHour.reset * 1000).toISOString()}>
                  {date(fiveHour.reset * 1000, timezone)} {timezone}
                </time>
              )}
            </div>
          </article>

          {/* Weekly Ceiling & AI Credits Card */}
          <article
            className={`card weekly-card${expiredWk ? " is-stale" : ""}${weeklyCapped ? " alert-coral" : ""}`}
            onClick={() => weekly && onSelectWindow(windowKey(weekly))}
          >
            <div className="card-top">
              <span className="overline">WEEKLY CEILING</span>
              {data.account.planTier && (
                <span className="pill-chip">{data.account.planTier}</span>
              )}
            </div>

            <div className="weekly-metric">
              <strong>
                {remWk !== null ? fmtPct(remWk) : "—"}
                <span>%</span>
              </strong>
              <small>remaining</small>
            </div>

            <div className="meter-track">
              <div
                className="meter-fill"
                style={{
                  width: `${remWk ?? 0}%`,
                  background: weeklyCapped ? "#f87171" : "#a78bfa",
                }}
              />
            </div>

            <p className="runway-note">
              {weeklyCapped
                ? "Weekly cap reached — 5-hour rolling refills pause until rollover."
                : "5-hour rolling refills operate normally underneath your weekly ceiling."}
            </p>

            <div className="credits-row">
              <span>Google One AI Credits</span>
              <strong
                className={
                  creditsActive
                    ? "text-violet"
                    : data.account.useG1Credits
                      ? "text-ok"
                      : ""
                }
              >
                {creditsActive
                  ? "Active fallback"
                  : data.account.useG1Credits === true
                    ? "Standby (enabled)"
                    : data.account.useG1Credits === false
                      ? "Off"
                      : "Not configured"}
              </strong>
            </div>

            <div className="card-footer">
              <strong>
                {weekly ? resetCountdown(weekly.reset, now) : "Awaiting reading"}
              </strong>
              {weekly?.reset !== null && weekly?.reset !== undefined && (
                <time dateTime={new Date(weekly.reset * 1000).toISOString()}>
                  {date(weekly.reset * 1000, timezone)}
                </time>
              )}
            </div>
          </article>
        </section>
      )}

      {/* Compact This 5h Window Activity Banner (mirrors Mission Control popover) */}
      <section className="card pulse-strip" aria-label="This 5-hour window activity">
        <div className="pulse-label">
          <span className="status-dot" />
          <strong>This 5h window</strong>
        </div>
        <div className="pulse-items">
          <span>
            <strong>{data.window5h.conversations}</strong> conversations
          </span>
          <span>
            <strong>{data.window5h.subagents + data.window5h.swarms}</strong>{" "}
            subagents &amp; swarms
          </span>
          <span>
            <strong>{data.window5h.browserRuns}</strong> browser runs
          </span>
          <span>
            <strong>{data.window5h.artifacts}</strong> artifacts
          </span>
        </div>
      </section>

      {data.coverage && (
        <MonitoringHealth
          coverage={data.coverage}
          collector={data.collector}
          tap={data.tap}
          cli={data.account.cli}
          scan={data.scan}
          demo={data.demo}
          now={now}
          timezone={timezone}
          unreachable={unreachable}
          busy={busy}
          onRetry={onRetry}
          onReconnect={onReconnect}
        />
      )}

      {/* Expandable Allowance History */}
      <details className="history-details" open>
        <summary>Allowance history</summary>
        <section className="card history-card">
          <div className="card-heading">
            <div>
              <h3>Remaining allowance over time</h3>
              <p className="subtle-note">
                {selected ? windowLabel(selected) : "Awaiting a reading"}
              </p>
            </div>
            <div className="chart-controls">
              {windows.length > 1 && (
                <select
                  aria-label="Allowance window"
                  value={selected ? windowKey(selected) : ""}
                  onChange={(e) => onSelectWindow(e.target.value)}
                >
                  {windows.map((w) => (
                    <option key={windowKey(w)} value={windowKey(w)}>
                      {windowLabel(w)}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="History range"
                value={range}
                onChange={(e) => onSelectRange(e.target.value)}
              >
                <option value="current">Current window</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </div>
          </div>

          {range === "current" && data.cycle && (
            <p className="subtle-note">
              {data.cycle.available && data.cycle.from !== null
                ? `Inferred window start: ${date(data.cycle.from, timezone)} ${timezone} · derived from reported reset minus window length`
                : data.cycle.reason}
            </p>
          )}

          {!historyReady ? (
            <div className="empty-chart">Loading allowance history…</div>
          ) : (
            <HistoryChart points={points} timezone={timezone} />
          )}

          <div className="chart-caption">
            <span>
              <span className="legend-line" /> Recorded readings ·{" "}
              {points.length}{" "}
              {points.length === 1 ? "observation" : "observations"}
            </span>
            <span>
              <span className="legend-gap" /> Sleep gap or window reset (never
              interpolated)
            </span>
          </div>
        </section>
      </details>
    </div>
  );
}
