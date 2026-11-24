import { existsSync } from "node:fs";
import type { Observation } from "../shared/types.ts";
import { windowMinutes } from "../shared/allowance.ts";
import { readJsonlIncremental } from "./jsonl.ts";
import { label, numeric, safeKey } from "./privacy.ts";
import type { Store } from "./store.ts";

export const tapParserVersion = 1;

/** Round reset timestamps to the nearest whole minute to suppress fractional-second jitter. */
export function roundResetSeconds(value: unknown, nowMs: number): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.round(parsed / 60_000) * 60;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const sec = value > 1e12 ? value / 1000 : value;
    if (sec > 1_500_000_000) return Math.round(sec / 60) * 60;
    if (sec >= 0) return Math.round((nowMs / 1000 + sec) / 60) * 60;
  }
  return null;
}

/**
 * Normalize an Antigravity quota key (e.g. "five_hour", "gemini-weekly", "gemini-pro-5h",
 * "third-party-weekly", "weekly") into a canonical `{ bucket, slot, duration }` tuple.
 */
export function normalizeQuotaKey(rawKey: string): {
  bucket: string;
  slot: string;
  duration: number | null;
} | null {
  const k = safeKey(rawKey);
  if (!k) return null;

  const is5h =
    k === "five_hour" ||
    k === "5h" ||
    k === "session" ||
    k.includes("five_hour") ||
    k.endsWith("_5h") ||
    k.includes("_5h_") ||
    k.includes("5_hour");
  const is7d =
    k === "seven_day" ||
    k === "weekly" ||
    k === "7d" ||
    k.includes("weekly") ||
    k.includes("seven_day") ||
    k.endsWith("_7d");

  const slotBase = is5h ? "five_hour" : is7d ? "seven_day" : k;
  const duration = windowMinutes[slotBase] ?? null;

  let bucket = "antigravity";
  if (k.includes("argon")) bucket = "gemini_argon";
  else if (k.includes("flash")) bucket = "gemini_flash";
  else if (k.includes("pro") || k.includes("neon")) bucket = "gemini_pro";
  else if (
    k.includes("claude") ||
    k.includes("gpt") ||
    k.includes("third_party") ||
    k.includes("3p")
  )
    bucket = "third_party";
  else if (k.includes("gemini") && (is5h || is7d)) bucket = "antigravity";

  return { bucket, slot: slotBase, duration };
}

/**
 * Parse one allowlisted JSONL record emitted by `scripts/agyscope-statusline.py`.
 * Maps Antigravity's `quota` dictionary (`remaining_fraction`, `used_percentage`, `reset_time`,
 * `reset_in_seconds`) into canonical `Observation` rows.
 */
export function parseTapRecord(
  line: string,
  account: string,
  hash: (v: unknown) => string,
): Observation[] {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object") return [];
  const at = numeric(raw.at);
  if (at === null || at <= 0) return [];

  const quota = raw.quota;
  if (!quota || typeof quota !== "object" || Array.isArray(quota)) return [];

  const planTier =
    typeof raw.plan_tier === "string" && raw.plan_tier.trim()
      ? label(raw.plan_tier)
      : null;
  const version =
    typeof raw.version === "string" && raw.version.trim()
      ? label(raw.version)
      : null;
  const session =
    typeof raw.session_id === "string" && raw.session_id.trim()
      ? hash(raw.session_id)
      : null;
  const creditsActive = raw.credits_active === true;

  const results: Observation[] = [];
  for (const [key, entry] of Object.entries(
    quota as Record<string, Record<string, unknown>>,
  )) {
    if (!entry || typeof entry !== "object") continue;
    const mapped = normalizeQuotaKey(key);
    if (!mapped) continue;

    let used: number | null = null;
    const remFrac = numeric(entry.remaining_fraction);
    const usedPct = numeric(entry.used_percentage);
    const remPct = numeric(entry.remaining_percentage);

    if (remFrac !== null && remFrac >= 0 && remFrac <= 1.05) {
      used = Math.round((1 - Math.min(1, remFrac)) * 1000) / 10;
    } else if (usedPct !== null && usedPct >= 0) {
      used = Math.round(usedPct * 10) / 10;
    } else if (remPct !== null && remPct >= 0 && remPct <= 100) {
      used = Math.round((100 - remPct) * 10) / 10;
    }
    if (used === null) continue;

    const reset =
      roundResetSeconds(entry.reset_time, at) ??
      roundResetSeconds(entry.reset_in_seconds, at);

    const flags: string[] = [];
    if (used > 100) flags.push("over-100");
    if (creditsActive) flags.push("credits-fallback");

    results.push({
      account,
      bucket: mapped.bucket,
      slot: mapped.slot,
      at,
      used,
      reset,
      duration: mapped.duration,
      source: "statusline",
      session,
      version,
      planTier,
      creditsActive,
      flags,
    });
  }

  // Flag when the overarching weekly ceiling has hit 100% used (which pauses 5h refills in Antigravity).
  const weeklyCapped = results.some(
    (o) => o.slot === "seven_day" && o.used >= 100,
  );
  if (weeklyCapped) {
    for (const o of results) {
      if (o.slot === "five_hour" && !o.flags.includes("weekly-cap-active"))
        o.flags.push("weekly-cap-active");
    }
  }

  return results;
}

export function importTapLog(
  tapLog: string,
  account: string,
  store: Store,
  hash: (v: unknown) => string,
  now = Date.now(),
): { lines: number; observations: number } {
  if (!existsSync(tapLog)) return { lines: 0, observations: 0 };
  const cursorKey = "tap:statusline";
  const prev = store.cursor(cursorKey);
  const pending: Observation[] = [];
  const res = readJsonlIncremental(tapLog, prev, tapParserVersion, (line) => {
    for (const o of parseTapRecord(line, account, hash)) pending.push(o);
  });
  if (!res) return { lines: 0, observations: 0 };
  let recorded = 0;
  store.transaction(() => {
    for (const o of pending) {
      if (store.observe(o)) recorded++;
    }
    store.saveCursor(cursorKey, res.cursor);
  });
  if (recorded > 0) {
    store.attempt({
      at: now,
      ok: true,
      message: `Status line import: ${recorded} reading${recorded === 1 ? "" : "s"}`,
    });
  }
  return { lines: res.lines, observations: recorded };
}
