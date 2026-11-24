export interface HistoryObservation {
  at: number;
  used: number;
  reset: number | null;
  chartSegment?: number;
}

export const remainingPercent = (used: number) =>
  Math.min(100, Math.max(0, 100 - used));

/** A reading under three minutes old is live. */
export const liveMs = 180_000;

/**
 * History keeps a row on every change and a heartbeat every ten minutes, so silence longer than fifteen
 * minutes is a real gap in readings, never measured usage.
 */
export const readingGapMs = 900_000;

export function historyBoundary(
  previous: HistoryObservation,
  current: HistoryObservation,
  maxInterval = readingGapMs,
): string | null {
  if (
    previous.chartSegment !== undefined &&
    current.chartSegment !== undefined &&
    previous.chartSegment !== current.chartSegment
  )
    return "No readings between these points; intervening values are unknown";
  if (
    previous.reset !== null &&
    current.reset !== null &&
    Math.abs(current.reset - previous.reset) > 60
  )
    return "Reported allowance window changed; exact reset time and cause are unconfirmed";
  if (current.used < previous.used)
    return "Usage counter decreased; possible reset or reporting adjustment";
  if (current.at - previous.at > maxInterval)
    return "No readings between these points";
  return null;
}
