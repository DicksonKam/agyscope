import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscriptLine } from "../server/parser.ts";

test("parseTranscriptLine extracts only allowlisted counters and tool names, never prompts or thinking", () => {
  const line = JSON.stringify({
    step_index: 4,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-11-23T17:30:00Z",
    model: "gemini-4-neon-high",
    input_tokens: 2400,
    cache_read_tokens: 14500,
    output_tokens: 512,
    thinking: "SECRET PRIVATE THOUGHTS SHOULD NEVER BE STORED",
    content: "SECRET RESPONSE CONTENT",
    tool_calls: [
      { name: "read_file", args: { Path: "/secret/path" } },
      { name: "invoke_subagent", args: { TypeName: '"browser"', Prompt: "secret" } },
      { name: "swarm", args: { action: "add" } },
      { name: "schedule", args: { DurationSeconds: 60 } },
      { name: "write_file", args: { Path: "/a", ArtifactMetadata: { UserFacing: true } } },
    ],
  });

  const event = parseTranscriptLine(line, "app", "convhash123");
  assert.ok(event);
  assert.equal(event.key, "app:convhash123:4");
  assert.equal(event.model, "gemini-4-neon-high");
  assert.equal(event.input, 2400);
  assert.equal(event.cacheRead, 14500);
  assert.equal(event.output, 512);
  assert.equal(event.subagentCalls, 1);
  assert.equal(event.browserCalls, 1);
  assert.equal(event.swarmCalls, 1);
  assert.equal(event.scheduleCalls, 1);
  assert.equal(event.artifactWrites, 1);
  assert.deepEqual(event.tools, [
    "read_file",
    "invoke_subagent",
    "swarm",
    "schedule",
    "write_file",
  ]);
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes("SECRET"));
  assert.ok(!serialized.includes("/secret/path"));
});

test("parseTranscriptLine ignores non-planner steps and malformed JSON", () => {
  assert.equal(
    parseTranscriptLine(
      JSON.stringify({ type: "USER_INPUT", step_index: 0, created_at: "2026-11-23T17:30:00Z", content: "hi" }),
      "app",
      "c1",
    ),
    null,
  );
  assert.equal(parseTranscriptLine("{bad json", "cli", "c1"), null);
});
