import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import {
  CliUsageReader,
  headlessChildEnv,
  parseCliUsageReport,
} from "../server/usage-reader.ts";

const alwaysOnline = async () => true;

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
    alwaysOnline,
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
    alwaysOnline,
  );
  assert.equal(await chargedReader.read(1000), false);
  assert.equal(chargedReader.state(1000).state, "stopped");
  assert.equal(store2.latest().length, 0);
  assert.equal(await chargedReader.read(9_999_999), false);
  assert.equal(calls, 1);

  // Official agy 1.5+ command.data.groups[].buckets[] shape (including epoch-0 unused pool reset)
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
              { id: "3p-weekly", window: "weekly", remaining_fraction: 1, reset_time: "1970-01-01T00:00:00Z" },
              { id: "3p-5h", window: "5h", remaining_fraction: 1, reset_time: "1970-01-01T00:00:00Z" },
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
    parsed15?.windows.find((w) => w.bucket === "third_party" && w.slot === "seven_day")?.reset,
    null,
    "placeholder 1970-01-01 epoch-0 reset_time should normalize to null",
  );

  store.close();
  store2.close();
});

test("DNS/offline preflight skips spawning agy completely and recovers when network returns", async () => {
  const store = new Store(":memory:");
  let online = false;
  let calls = 0;
  const reader = new CliUsageReader(
    store,
    async () => {
      calls++;
      return {
        code: 0,
        stdout: JSON.stringify({
          num_turns: 0,
          usage: { total_tokens: 0 },
          quota: { "gemini-5h": { remaining_fraction: 0.9 } },
        }),
        stderr: "",
      };
    },
    "agy",
    () => "acct",
    () => true,
    async () => online,
  );

  assert.equal(await reader.read(10_000), false);
  assert.equal(calls, 0, "agy must never be spawned while offline/DNS is down");
  assert.equal(reader.state(10_000).state, "offline");

  online = true;
  assert.equal(await reader.read(100_000), true);
  assert.equal(calls, 1);
  assert.equal(reader.state(100_000).state, "ok");
  store.close();
});

test("interactive OAuth or silent-auth timeout trips a persistent circuit breaker until manual refresh", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  let mode: "oauth" | "ok" = "oauth";
  const run = async () => {
    calls++;
    if (mode === "oauth") {
      return { code: null, stdout: "", stderr: "", authTriggered: true };
    }
    return {
      code: 0,
      stdout: JSON.stringify({
        num_turns: 0,
        usage: { total_tokens: 0 },
        quota: { "gemini-5h": { remaining_fraction: 0.85 } },
      }),
      stderr: "",
    };
  };

  const reader1 = new CliUsageReader(store, run, "agy", () => "acct", () => true, alwaysOnline);
  assert.equal(await reader1.read(10_000), false);
  assert.equal(reader1.state(10_000).state, "signed-out");
  assert.equal(calls, 1);

  // Automatic retries hours later must NOT spawn agy again
  assert.equal(await reader1.read(99_000_000), false);
  assert.equal(calls, 1, "must not retry automatically after auth circuit breaker trips");

  // Even after a service restart (new CliUsageReader instance on same Store), stay paused
  const reader2 = new CliUsageReader(store, run, "agy", () => "acct", () => true, alwaysOnline);
  assert.equal(reader2.state(99_500_000).state, "signed-out");
  assert.equal(await reader2.read(99_500_000), false);
  assert.equal(calls, 1, "auth pause must persist across service restarts");

  // Explicit manual refresh clears the circuit breaker and resumes
  mode = "ok";
  assert.equal(await reader2.read(100_000_000, true), true);
  assert.equal(calls, 2);
  assert.equal(reader2.state(100_000_000).state, "ok");
  store.close();
});

test("3 consecutive unknown CLI errors trip the universal circuit breaker, and child env strips PATH/browser", async () => {
  const env = headlessChildEnv({ HOME: "/tmp/h", PATH: "/usr/bin:/bin", BROWSER: "open" });
  assert.equal(env.PATH, "");
  assert.equal(env.NO_BROWSER, "1");
  assert.equal(env.BROWSER, "");
  assert.equal(env.CI, "true");

  const store = new Store(":memory:");
  let calls = 0;
  const reader = new CliUsageReader(
    store,
    async () => {
      calls++;
      return { code: 1, stdout: "", stderr: "unexpected crash" };
    },
    "agy",
    () => "acct",
    () => true,
    alwaysOnline,
  );
  assert.equal(await reader.read(1_000_000), false);
  assert.equal(await reader.read(2_000_000), false);
  assert.equal(await reader.read(4_000_000), false);
  assert.equal(calls, 3);
  assert.equal(reader.state(4_000_000).state, "signed-out");
  // 4th automatic call is blocked by the universal circuit breaker
  assert.equal(await reader.read(99_000_000), false);
  assert.equal(calls, 3);
  store.close();
});

test("a single silent-auth timeout (e.g. sleep/wake blip) auto-recovers instead of pausing permanently", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  const reader = new CliUsageReader(
    store,
    async () => {
      calls++;
      if (calls === 1) {
        return { code: null, stdout: "", stderr: "", silentAuthTimedOut: true };
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          num_turns: 0,
          usage: { total_tokens: 0 },
          quota: { "gemini-5h": { remaining_fraction: 0.91 } },
        }),
        stderr: "",
      };
    },
    "agy",
    () => "acct",
    () => true,
    alwaysOnline,
  );
  assert.equal(await reader.read(1_000_000), false);
  assert.equal(reader.state(1_000_000).state, "error");
  // After 1-minute backoff, recovers automatically with no manual intervention
  assert.equal(await reader.read(1_120_000), true);
  assert.equal(calls, 2);
  assert.equal(reader.state(1_120_000).state, "ok");
  store.close();
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
