import React from "react";
import type { DashboardState } from "../shared/api";
import { elapsed } from "./time";

const num = (n: number) => Intl.NumberFormat("en").format(n);
const compact = (n: number) =>
  Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

export function AgentsWork({
  data,
  now,
}: {
  data: DashboardState;
  now: number;
}) {
  const w5 = data.window5h;
  const totals = data.totals;
  const totalInput = (totals?.input ?? 0) + (totals?.cacheRead ?? 0);
  const cacheHit =
    totalInput > 0
      ? Math.round(((totals?.cacheRead ?? 0) / totalInput) * 100)
      : 0;

  return (
    <div className="page-stack">
      <section className="card">
        <div className="card-heading">
          <div>
            <h3>This 5-hour window · agentic footprint</h3>
            <p className="subtle-note">
              Antigravity meters computational work rather than flat prompts.
              This mirrors the Mission Control strip in your menu bar popover.
            </p>
          </div>
        </div>
        <div className="stat-grid-4">
          <div className="stat-tile">
            <span>Conversations</span>
            <strong>{num(w5.conversations)}</strong>
            <small>{num(w5.responses)} planner steps</small>
          </div>
          <div className="stat-tile">
            <span>Subagents &amp; Swarms</span>
            <strong>{num(w5.subagents + w5.swarms)}</strong>
            <small>
              {num(w5.subagents)} subagents · {num(w5.swarms)} swarm ops
            </small>
          </div>
          <div className="stat-tile">
            <span>Browser &amp; Schedules</span>
            <strong>{num(w5.browserRuns + w5.scheduledTasks)}</strong>
            <small>
              {num(w5.browserRuns)} browser · {num(w5.scheduledTasks)} scheduled
            </small>
          </div>
          <div className="stat-tile">
            <span>Artifacts Created</span>
            <strong>{num(w5.artifacts)}</strong>
            <small>{compact(w5.output)} output tokens</small>
          </div>
        </div>
      </section>

      {totals && (
        <section className="card">
          <div className="card-heading">
            <div>
              <h3>All-time local transcript totals</h3>
              <p className="subtle-note">
                Scanned incrementally from local Antigravity App &amp; CLI brain
                transcripts. Only numeric counters and tool labels are retained.
              </p>
            </div>
          </div>
          <div className="stat-grid-4">
            <div className="stat-tile">
              <span>Planner responses</span>
              <strong>{num(totals.responses)}</strong>
              <small>{num(totals.conversations)} conversations</small>
            </div>
            <div className="stat-tile">
              <span>Cache read</span>
              <strong>{compact(totals.cacheRead)}</strong>
              <small>{cacheHit}% input cache hit</small>
            </div>
            <div className="stat-tile">
              <span>Uncached input</span>
              <strong>{compact(totals.input)}</strong>
              <small>fresh context tokens</small>
            </div>
            <div className="stat-tile">
              <span>Output tokens</span>
              <strong>{compact(totals.output)}</strong>
              <small>{num(totals.artifacts)} artifacts</small>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-heading">
          <div>
            <h3>Recent conversations</h3>
            <p className="subtle-note">
              Pseudonymous hashed IDs only — no workspace paths or conversation
              titles are persisted.
            </p>
          </div>
        </div>
        {!data.recentConversations?.length ? (
          <p className="subtle-note">No local Antigravity sessions recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Surface</th>
                  <th>Primary model</th>
                  <th>Steps</th>
                  <th>Subagents / Swarms</th>
                  <th>Browser</th>
                  <th>Artifacts</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {data.recentConversations.map((c) => (
                  <tr key={`${c.surface}-${c.id}`}>
                    <td className="mono">{c.id}</td>
                    <td>
                      <span className="pill-chip">
                        {c.surface === "app" ? "App" : "CLI"}
                      </span>
                    </td>
                    <td className="mono">{c.topModel}</td>
                    <td>{num(c.responses)}</td>
                    <td>{num(c.subagents + c.swarms)}</td>
                    <td>{num(c.browserRuns)}</td>
                    <td>{num(c.artifacts)}</td>
                    <td className="muted-cell">{elapsed(c.lastAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
