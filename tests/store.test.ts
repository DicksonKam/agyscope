import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";

test("Store deduplicates unchanged readings inside heartbeat and computes work summaries", () => {
  const store = new Store(":memory:");
  const baseAt = 1_800_000_000_000;
  for (let i = 0; i < 4; i++) {
    store.observe({
      account: "acct",
      bucket: "antigravity",
      slot: "five_hour",
      at: baseAt + i * 60_000,
      used: 20,
      reset: 1_800_010_800,
      duration: 300,
      source: "statusline",
      session: null,
      version: "2.0",
      planTier: "Pro",
      creditsActive: false,
      flags: [],
    });
  }
  assert.equal(store.observations().length, 1);
  assert.equal(store.latest().length, 1);
  assert.equal(store.latest()[0].at, baseAt + 3 * 60_000);

  store.recordEvent({
    key: "app:c1:1",
    surface: "app",
    conversation: "c1",
    at: baseAt,
    model: "gemini-4-neon-high",
    input: 1000,
    cacheRead: 5000,
    output: 300,
    tools: ["read_file", "invoke_subagent"],
    subagentCalls: 1,
    swarmCalls: 0,
    browserCalls: 1,
    scheduleCalls: 0,
    artifactWrites: 1,
    flags: [],
  });
  // Idempotent duplicate insert
  assert.equal(
    store.recordEvent({
      key: "app:c1:1",
      surface: "app",
      conversation: "c1",
      at: baseAt,
      model: "gemini-4-neon-high",
      input: 1000,
      cacheRead: 5000,
      output: 300,
      tools: ["read_file", "invoke_subagent"],
      subagentCalls: 1,
      swarmCalls: 0,
      browserCalls: 1,
      scheduleCalls: 0,
      artifactWrites: 1,
      flags: [],
    }),
    false,
  );

  const summary = store.workSummary();
  assert.equal(summary.conversations, 1);
  assert.equal(summary.responses, 1);
  assert.equal(summary.subagents, 1);
  assert.equal(summary.browserRuns, 1);
  assert.equal(summary.artifacts, 1);
  assert.equal(store.modelBreakdown()[0].model, "gemini-4-neon-high");
  assert.equal(store.topTools().length, 2);
  store.close();
});
