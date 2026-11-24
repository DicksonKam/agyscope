import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeQuotaKey, parseTapRecord } from "../server/statusline.ts";

test("normalizeQuotaKey maps Antigravity 5h, weekly, and model pool keys cleanly", () => {
  assert.deepEqual(normalizeQuotaKey("gemini-5h"), {
    bucket: "antigravity",
    slot: "five_hour",
    duration: 300,
  });
  assert.deepEqual(normalizeQuotaKey("gemini-weekly"), {
    bucket: "antigravity",
    slot: "seven_day",
    duration: 10080,
  });
  assert.deepEqual(normalizeQuotaKey("gemini-flash-5h"), {
    bucket: "gemini_flash",
    slot: "five_hour",
    duration: 300,
  });
  assert.deepEqual(normalizeQuotaKey("third-party-weekly"), {
    bucket: "third_party",
    slot: "seven_day",
    duration: 10080,
  });
});

test("parseTapRecord converts remaining_fraction into used % and flags weekly cap interaction", () => {
  const line = JSON.stringify({
    v: 1,
    at: 1_800_000_000_000,
    version: "2.0.1",
    plan_tier: "Ultra",
    session_id: "raw-session-id",
    credits_active: true,
    quota: {
      "gemini-5h": {
        remaining_fraction: 0.82,
        reset_time: "2026-11-24T05:00:00.412Z",
      },
      "gemini-weekly": {
        remaining_fraction: 0,
        reset_time: "2026-11-29T00:00:00.120Z",
      },
    },
  });

  const obs = parseTapRecord(line, "acct-hash", (v) => `h_${v}`);
  assert.equal(obs.length, 2);
  const fiveH = obs.find((o) => o.slot === "five_hour")!;
  const weekly = obs.find((o) => o.slot === "seven_day")!;
  assert.equal(fiveH.used, 18);
  assert.equal(fiveH.planTier, "Ultra");
  assert.equal(fiveH.creditsActive, true);
  assert.equal(fiveH.session, "h_raw-session-id");
  assert.ok(fiveH.flags.includes("weekly-cap-active"));
  assert.ok(fiveH.flags.includes("credits-fallback"));
  assert.equal(weekly.used, 100);
});
