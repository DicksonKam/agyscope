import type { Store } from "./store.ts";
import type { Observation } from "../shared/types.ts";
import { readingGapMs } from "../shared/history.ts";

export interface ChartObservation extends Observation {
  chartSegment: number;
}

export const historyLimit = 600;

/**
 * Range-scoped, segment-aware sampling: preserves both sides of every reset or gap plus
 * first, last, minimum and maximum per time bin so long ranges stay accurate and bounded.
 */
export function queryHistory(
  store: Store,
  window: Pick<Observation, "account" | "bucket" | "slot">,
  from: number,
  to: number,
) {
  const sql = `WITH raw AS MATERIALIZED (
    SELECT key,at,data,CAST(json_extract(data,'$.used') AS REAL) AS used,json_extract(data,'$.reset') AS reset
    FROM observations WHERE json_extract(data,'$.account')=? AND json_extract(data,'$.bucket')=?
      AND json_extract(data,'$.slot')=? AND json_extract(data,'$.source') IN ('statusline','cli','demo','manual') AND at>=? AND at<=?
  ), previous AS (
    SELECT *,lag(at) OVER w AS previous_at,lag(used) OVER w AS previous_used,lag(reset) OVER w AS previous_reset
    FROM raw WINDOW w AS (ORDER BY at,key)
  ), marked AS (
    SELECT key,at,used,CASE WHEN previous_at IS NULL OR at-previous_at>? OR used<previous_used
      OR abs(coalesce(reset,0)-coalesce(previous_reset,0))>60 THEN 1 ELSE 0 END AS boundary FROM previous
  ), charted AS MATERIALIZED (
    SELECT *,sum(boundary) OVER w AS segment,coalesce(lead(boundary) OVER w,1) AS end_boundary,
      CAST((at-?)*100.0/? AS INTEGER) AS bin FROM marked WINDOW w AS (ORDER BY at,key)
  ), bins AS (
    SELECT bin,min(at) AS first_at,max(at) AS last_at,min(used) AS low,max(used) AS high FROM charted GROUP BY bin
  ), picks AS (
    SELECT bin,first_at,last_at,min(CASE WHEN used=low THEN at END) AS low_at,
      min(CASE WHEN used=high THEN at END) AS high_at FROM charted JOIN bins USING(bin) GROUP BY bin
  ) SELECT raw.data,charted.segment FROM charted JOIN picks USING(bin) JOIN raw USING(key)
    WHERE (SELECT count(*) FROM raw)<=? OR boundary=1 OR end_boundary=1
      OR charted.at IN(first_at,last_at,low_at,high_at)
    ORDER BY charted.at DESC,charted.key DESC LIMIT ?`;
  const rows = store.db
    .prepare(sql)
    .all(
      window.account,
      window.bucket,
      window.slot,
      from,
      to,
      readingGapMs,
      from,
      Math.max(1, to - from + 1),
      historyLimit,
      historyLimit + 1,
    ) as { data: string; segment: number }[];
  const truncated = rows.length > historyLimit;
  const points: ChartObservation[] = rows
    .slice(0, historyLimit)
    .reverse()
    .map((r) => ({ ...JSON.parse(r.data), chartSegment: r.segment }));
  return { points, truncated };
}

export function coverage(
  store: Store,
  thresholdMs = readingGapMs,
  limit = 20,
  now = Date.now(),
) {
  const first = (
    store.db.prepare("SELECT min(at) AS at FROM observations").get() as {
      at: number | null;
    }
  ).at;
  const last = (
    store.db.prepare("SELECT max(at) AS at FROM latest").get() as {
      at: number | null;
    }
  ).at;
  const from = now - 7 * 86_400_000;
  const intervals = `WITH readings AS (SELECT DISTINCT at FROM observations WHERE at >= ?),
    intervals AS (SELECT lag(at) OVER (ORDER BY at) AS start, at AS end FROM readings)`;
  const count = (
    store.db
      .prepare(
        `${intervals} SELECT count(*) AS n FROM intervals WHERE end-start>?`,
      )
      .get(from, thresholdMs) as { n: number }
  ).n;
  const gaps = store.db
    .prepare(
      `${intervals} SELECT start,end FROM intervals WHERE end-start>? ORDER BY end DESC LIMIT ?`,
    )
    .all(from, thresholdMs, limit) as { start: number; end: number }[];
  return {
    firstReadingAt: first,
    lastReadingAt: last,
    thresholdMs,
    gapCount: count,
    gaps: gaps.map((g) => ({ start: g.start, end: g.end })),
  };
}
