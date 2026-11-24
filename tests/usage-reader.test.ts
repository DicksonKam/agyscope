import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import {
  CliUsageReader,
  parseCliUsageReport,
} from "../server/usage-reader.ts";

test("CliUsageReader records zero-token quota reports and stops immediately if tokens are charged", async () => {
  const store = new Store(":memory:");
  const okPayload = JSON.stringify({
    plan_tier: "Ultra",
    credits_active: false,
    num_turns: 0,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    quota: {
      "gemini-5h": {
        remaining_fraction: 0.78,
        reset_time: "2026-11-24T05:00:00Z",
      },
      "gemini-weekly": {
        remaining_fraction: 0.61,
        reset_time: "2026-11-29T00:00:00Z",
      },
    },
  });

  const parsed = parseCliUsageReport(okPayload);
  assert.ok(parsed?.available);
  assert.equal(parsed?.windows.length, 2);

  const reader = new CliUsageReader(
    store,
    async () => ({ code: 0, stdout: okPayload, stderr: "" }),
    "agy",
    () => "acct",
    () => true,
  );
  assert.equal(await reader.read(1_800_000_000_000), true);
  assert.equal(store.latest().length, 2);
  assert.equal(reader.state(1_800_000_000_000).state, "ok");

  // Charged response triggers immediate permanent stop
  const store2 = new Store(":memory:");
  let calls = 0;
  const chargedReader = new CliUsageReader(
    store2,
    async () => {
      calls++;
      return {
        code: 0,
        stdout: JSON.stringify({
          num_turns: 1,
          usage: { input_tokens: 120, output_tokens: 15 },
          quota: { "gemini-5h": { remaining_fraction: 0.8 } },
        }),
        stderr: "",
      };
    },
    "agy",
    () => "acct",
    () => true,
  );
  assert.equal(await chargedReader.read(1000), false);
  assert.equal(chargedReader.state(1000).state, "stopped");
  assert.equal(store2.latest().length, 0);
  assert.equal(await chargedReader.read(9_999_999), false);
  assert.equal(calls, 1);

  // Official agy 1.5+ command.data.groups[].buckets[] shape
  const agy15Payload = JSON.stringify({
    conversation_id: "",
    status: "SUCCESS",
    duration_seconds: 0,
    num_turns: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      thinking_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
    },
    command: {
      name: "usage",
      data: {
        groups: [
          {
            name: "Gemini Models",
            buckets: [
              { id: "gemini-weekly", window: "weekly", remaining_fraction: 0.49, reset_time: "2026-11-29T14:09:03Z" },
              { id: "gemini-5h", window: "5h", remaining_fraction: 0.92, reset_time: "2026-11-23T23:12:17Z" },
            ],
          },
          {
            name: "Claude and GPT models",
            buckets: [
              { id: "3p-weekly", window: "weekly", remaining_fraction: 0.44, reset_time: "2026-11-29T14:44:01Z" },
              { id: "3p-5h", window: "5h", remaining_fraction: 1, reset_time: "2026-11-23T23:21:17Z" },
            ],
          },
          {
            name: "Gemini 4 Argon",
            buckets: [
              { id: "gemini-argon-wtu-weekly", window: "weekly", remaining_fraction: 1, reset_time: "2026-11-30T18:21:17Z" },
            ],
          },
        ],
      },
    },
  });
  const parsed15 = parseCliUsageReport(agy15Payload);
  assert.ok(parsed15?.available);
  assert.equal(parsed15?.tokens, 0);
  assert.equal(parsed15?.turns, 0);
  assert.equal(parsed15?.windows.length, 5);
  assert.equal(
    parsed15?.windows.find((w) => w.bucket === "antigravity" && w.slot === "five_hour")?.used,
    8,
  );
  assert.equal(
    parsed15?.windows.find((w) => w.bucket === "gemini_argon" && w.slot === "seven_day")?.used,
    0,
  );

  store.close();
  store2.close();
});

test("no AGYScope source code reads credentials or contacts Google endpoints directly", () => {
  const root = join(import.meta.dirname, "..");
  for (const folder of ["server", "shared", "src", "macos", "scripts"]) {
    for (const file of readdirSync(join(root, folder))) {
      const text = readFileSync(join(root, folder, file), "utf8");
      for (const forbidden of [
        /find-generic-password/,
        /oauth_creds\.json/,
        /generativelanguage\.googleapis\.com/,
        /cloudcode-pa\.googleapis\.com/,
        /Authorization/,
        /Bearer /,
      ]) {
        assert.ok(
          !forbidden.test(text),
          `${folder}/${file} matches forbidden pattern ${forbidden}`,
        );
      }
    }
  }
});
