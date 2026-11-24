import type { ActivityEvent, Surface } from "../shared/types.ts";
import { integer, label } from "./privacy.ts";

export const parserVersion = 1;

/**
 * Strict allowlist parser for Antigravity `transcript.jsonl` lines.
 * Only inspects PLANNER_RESPONSE steps and keeps numeric token counters, model label,
 * timestamp, and machine tool names. Prompts, replies, thinking, and tool arguments
 * are never retained.
 */
export function parseTranscriptLine(
  line: string,
  surface: Surface,
  conversationHash: string,
): ActivityEvent | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  if (raw.type !== "PLANNER_RESPONSE") return null;

  const stepIndex = integer(raw.step_index);
  const createdAt =
    typeof raw.created_at === "string" ? Date.parse(raw.created_at) : NaN;
  if (stepIndex === null || !Number.isFinite(createdAt)) return null;

  const input = integer(raw.input_tokens) ?? 0;
  const cacheRead = integer(raw.cache_read_tokens) ?? 0;
  const output = integer(raw.output_tokens) ?? 0;
  const model = label(raw.model);

  const tools: string[] = [];
  let subagentCalls = 0;
  let swarmCalls = 0;
  let browserCalls = 0;
  let scheduleCalls = 0;
  let artifactWrites = 0;

  if (Array.isArray(raw.tool_calls)) {
    for (const tc of raw.tool_calls as Record<string, unknown>[]) {
      const name = label(tc?.name);
      if (name === "unknown") continue;
      tools.push(name);
      if (name === "invoke_subagent") {
        subagentCalls++;
        const args = tc?.args as Record<string, unknown> | undefined;
        const typeName =
          typeof args?.TypeName === "string"
            ? args.TypeName.replaceAll('"', "").toLowerCase()
            : "";
        if (typeName === "browser") browserCalls++;
      } else if (name === "swarm") {
        swarmCalls++;
      } else if (name === "schedule") {
        scheduleCalls++;
      } else if (name.includes("browser")) {
        browserCalls++;
      } else if (name === "write_file") {
        const args = tc?.args as Record<string, unknown> | undefined;
        if (args && args.ArtifactMetadata !== undefined) artifactWrites++;
      }
    }
  }

  return {
    key: `${surface}:${conversationHash}:${stepIndex}`,
    surface,
    conversation: conversationHash,
    at: createdAt,
    model,
    input,
    cacheRead,
    output,
    tools: [...new Set(tools)],
    subagentCalls,
    swarmCalls,
    browserCalls,
    scheduleCalls,
    artifactWrites,
    flags: [],
  };
}
