import React from "react";
import type { DashboardState } from "../shared/api";
import { windowKey, windowLabel } from "../shared/allowance";
import { remainingPercent } from "../shared/history";
import { elapsed, resetCountdown } from "./time";

const num = (n: number) => Intl.NumberFormat("en").format(n);
const compact = (n: number) =>
  Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

export function ModelsTools({
  data,
  now,
  onInspectWindow,
}: {
  data: DashboardState;
  now: number;
  onInspectWindow: (key: string) => void;
}) {
  const models = data.models ?? [];
  const surfaces = data.surfaces ?? [];
  const tools = data.tools ?? [];
  const maxTool = tools.length ? Math.max(...tools.map((t) => t.count)) : 1;
  const maxModel = models.length
    ? Math.max(...models.map((m) => m.responses))
    : 1;
  const totalSurfaceSteps = surfaces.reduce((s, r) => s + r.responses, 0);

  return (
    <div className="page-stack">
      {/* Reported Quota Pools */}
      <section className="card">
        <div className="card-heading">
          <div>
            <h3>Reported quota pools</h3>
            <p className="subtle-note">
              Click any pool to jump to its history curve in Quota &amp; Runway.
            </p>
          </div>
        </div>
        {!data.windows.length ? (
          <p className="subtle-note">
            No quota pools reported yet. Install the <code>agy</code> statusLine
            tap or run <code>npm run demo</code> to preview multi-pool meters.
          </p>
        ) : (
          <div className="pool-grid">
            {data.windows.map((w) => {
              const rem = remainingPercent(w.used);
              const key = windowKey(w);
              return (
                <button
                  key={key}
                  className="pool-card"
                  onClick={() => onInspectWindow(key)}
                >
                  <div className="pool-top">
                    <strong>{windowLabel(w)}</strong>
                    <span>
                      {Number.isInteger(rem) ? rem : rem.toFixed(1)}% left
                    </span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill prism-fill"
                      style={{ width: `${rem}%` }}
                    />
                  </div>
                  <div className="pool-sub">
                    <span>{resetCountdown(w.reset, now)}</span>
                    <span>{elapsed(w.at, now)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="two-col">
        {/* Model Breakdown */}
        <section className="card">
          <div className="card-heading">
            <div>
              <h3>Model usage (local transcripts)</h3>
              <p className="subtle-note">
                Planner steps and token volume by model on this Mac.
              </p>
            </div>
          </div>
          {!models.length ? (
            <p className="subtle-note">No model activity recorded yet.</p>
          ) : (
            <div className="bar-list">
              {models.map((m) => (
                <div key={m.model} className="bar-row">
                  <div className="bar-row-head">
                    <span className="mono">{m.model}</span>
                    <span>
                      {num(m.responses)} steps · {compact(m.output)} out
                    </span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill prism-fill"
                      style={{
                        width: `${Math.max(4, (m.responses / maxModel) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Surfaces & Tools */}
        <section className="card">
          <div className="card-heading">
            <div>
              <h3>Surfaces &amp; top tools</h3>
              <p className="subtle-note">
                Antigravity App vs. CLI sessions and most-invoked agent tools.
              </p>
            </div>
          </div>

          <div className="surface-pills">
            {surfaces.length ? (
              surfaces.map((s) => {
                const pct =
                  totalSurfaceSteps > 0
                    ? Math.round((s.responses / totalSurfaceSteps) * 100)
                    : 0;
                return (
                  <div key={s.surface} className="surface-chip">
                    <strong>
                      {s.surface === "app"
                        ? "Antigravity App"
                        : "Antigravity CLI"}
                    </strong>
                    <span>
                      {pct}% · {num(s.conversations)} sessions
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="subtle-note">No surface data scanned yet.</p>
            )}
          </div>

          {tools.length > 0 && (
            <div className="bar-list" style={{ marginTop: 18 }}>
              {tools.map((t) => (
                <div key={t.name} className="bar-row">
                  <div className="bar-row-head">
                    <span className="mono">{t.name}</span>
                    <span>{num(t.count)}</span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${Math.max(4, (t.count / maxTool) * 100)}%`,
                        background: "#60a5fa",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
