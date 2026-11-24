import type { Observation } from "./types.ts";

/** Window lengths implied by known Antigravity quota slots. */
export const windowMinutes: Record<string, number> = {
  five_hour: 300,
  seven_day: 10080,
};

export function slotRank(slot: string): number {
  if (slot === "five_hour") return 0;
  if (slot.startsWith("five_hour_")) return 1;
  if (slot === "seven_day") return 2;
  if (slot.startsWith("seven_day_")) return 3;
  return 4;
}

export function bucketRank(bucket: string): number {
  if (bucket === "antigravity") return 0;
  if (bucket === "gemini" || bucket === "gemini_pro") return 1;
  if (bucket === "gemini_argon") return 2;
  if (bucket === "gemini_flash") return 3;
  if (bucket === "third_party") return 4;
  return 5;
}

export const windowKey = (o: Pick<Observation, "bucket" | "slot">) =>
  JSON.stringify([o.bucket, o.slot]);

export function sortWindows(windows: Observation[]): Observation[] {
  return [...windows].sort((a, b) => {
    if (bucketRank(a.bucket) !== bucketRank(b.bucket))
      return bucketRank(a.bucket) - bucketRank(b.bucket);
    if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
    if (slotRank(a.slot) !== slotRank(b.slot))
      return slotRank(a.slot) - slotRank(b.slot);
    return a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0;
  });
}

const bucketDisplay: Record<string, string> = {
  antigravity: "Gemini Models",
  gemini: "Gemini Models",
  gemini_pro: "Gemini Pro / Neon",
  gemini_argon: "Gemini 4 Argon",
  gemini_flash: "Gemini Flash",
  third_party: "Claude & GPT",
};

export function bucketLabel(bucket: string): string {
  if (bucketDisplay[bucket]) return bucketDisplay[bucket];
  return bucket
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function windowLabel(
  o: Pick<Observation, "bucket" | "slot" | "duration">,
): string {
  const name = bucketLabel(o.bucket);
  if (o.slot === "five_hour") return `${name} · 5 hours`;
  if (o.slot === "seven_day") return `${name} · Weekly`;
  if (o.slot.startsWith("five_hour_")) {
    const pool = o.slot.slice("five_hour_".length).replaceAll("_", " ");
    return `${name} · 5h · ${pool.replace(/\b\w/g, (c) => c.toUpperCase())}`;
  }
  if (o.slot.startsWith("seven_day_")) {
    const pool = o.slot.slice("seven_day_".length).replaceAll("_", " ");
    return `${name} · Weekly · ${pool.replace(/\b\w/g, (c) => c.toUpperCase())}`;
  }
  const minutes = o.duration;
  if (!minutes || minutes <= 0)
    return `${name} · ${o.slot.replaceAll("_", " ")}`;
  if (minutes % 1440 === 0)
    return `${name} · ${minutes / 1440} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes % 60 === 0)
    return `${name} · ${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `${name} · ${minutes} minutes`;
}

/** Pick the primary 5-hour window and primary weekly ceiling across reported windows. */
export function selectPrimaryPair(windows: Observation[]): {
  fiveHour: Observation | null;
  weekly: Observation | null;
} {
  const sorted = sortWindows(windows);
  const fiveHour =
    sorted.find((w) => w.bucket === "antigravity" && w.slot === "five_hour") ??
    sorted.find((w) => w.slot === "five_hour") ??
    sorted.find((w) => w.slot.startsWith("five_hour_")) ??
    null;
  const weekly =
    sorted.find((w) => w.bucket === "antigravity" && w.slot === "seven_day") ??
    sorted.find((w) => w.slot === "seven_day") ??
    sorted.find((w) => w.slot.startsWith("seven_day_")) ??
    null;
  return { fiveHour, weekly };
}

export const remaining = (used: number) =>
  Math.min(100, Math.max(0, 100 - used));
