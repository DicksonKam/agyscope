import React, { useId, useState } from "react";
import { historyBoundary, type HistoryObservation } from "../shared/history";
import { date, shortDate, shortTime, timezonePreference } from "./time";

export interface ChartPoint extends HistoryObservation {
  remaining: number;
}

export function HistoryChart({
  points,
  timezone,
}: {
  points: ChartPoint[];
  timezone: string;
}) {
  const uid = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  if (!points.length) {
    return (
      <div className="empty-chart">
        No recorded quota readings in this range yet. Readings appear as
        AGYScope collects them.
      </div>
    );
  }

  const width = 760;
  const height = 210;
  const pad = { top: 18, right: 16, bottom: 30, left: 38 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const minT = points[0].at;
  const maxT = Math.max(points[points.length - 1].at, minT + 60_000);
  const shortSpan = maxT - minT < 172_800_000;

  const x = (at: number) => pad.left + ((at - minT) / (maxT - minT)) * plotW;
  const y = (rem: number) =>
    pad.top + plotH - (Math.max(0, Math.min(100, rem)) / 100) * plotH;

  const solidSegments: string[] = [];
  const gapSegments: string[] = [];
  let currentPath = `M ${x(points[0].at).toFixed(1)} ${y(points[0].remaining).toFixed(1)}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const px = x(curr.at).toFixed(1);
    const py = y(curr.remaining).toFixed(1);
    if (historyBoundary(prev, curr)) {
      solidSegments.push(currentPath);
      gapSegments.push(
        `M ${x(prev.at).toFixed(1)} ${y(prev.remaining).toFixed(1)} L ${px} ${py}`,
      );
      currentPath = `M ${px} ${py}`;
    } else {
      currentPath += ` L ${px} ${py}`;
    }
  }
  solidSegments.push(currentPath);

  const ticksX = [minT, minT + (maxT - minT) / 2, maxT];
  const active = hovered !== null ? points[hovered] : null;

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Remaining allowance over time"
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < points.length; i++) {
            const dist = Math.abs(x(points[i].at) - relX);
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = i;
            }
          }
          setHovered(bestIdx);
        }}
      >
        <defs>
          <linearGradient id={`${uid}-line`} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="55%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line
              className="grid-line"
              x1={pad.left}
              x2={width - pad.right}
              y1={y(v)}
              y2={y(v)}
            />
            <text x={pad.left - 8} y={y(v) + 3.5} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x={pad.left} y={11} className="axis-title">
          % remaining
        </text>
        {ticksX.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          >
            {shortSpan ? shortTime(t, timezone) : shortDate(t, timezone)}
          </text>
        ))}
        {gapSegments.map((d, i) => (
          <path key={`g-${i}`} d={d} className="gap-line" />
        ))}
        {solidSegments.map((d, i) => (
          <path
            key={`s-${i}`}
            d={d}
            className="data-line"
            stroke={`url(#${uid}-line)`}
          />
        ))}
        {points.length <= 80 &&
          points.map((p, i) => (
            <circle
              key={i}
              cx={x(p.at)}
              cy={y(p.remaining)}
              r={hovered === i ? 4.5 : 2.3}
              className="data-dot"
            />
          ))}
        {active && (
          <g>
            <line
              x1={x(active.at)}
              x2={x(active.at)}
              y1={pad.top}
              y2={height - pad.bottom}
              className="hover-rule"
            />
            <circle
              cx={x(active.at)}
              cy={y(active.remaining)}
              r={5}
              className="data-dot-active"
            />
          </g>
        )}
      </svg>
      <div className="chart-inspect">
        {active ? (
          <span>
            <strong>
              {Number.isInteger(active.remaining)
                ? active.remaining
                : active.remaining.toFixed(1)}
              % remaining
            </strong>{" "}
            · {date(active.at, timezone)} ({timezonePreference()})
          </span>
        ) : (
          <span>Hover across the curve to inspect exact recorded readings.</span>
        )}
      </div>
    </div>
  );
}
