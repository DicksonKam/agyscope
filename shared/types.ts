export type Source = "statusline" | "cli" | "demo" | "manual";

export type Surface = "app" | "cli";

/** One reading of one Antigravity allowance window or model pool. */
export interface Observation {
  account: string; // hashed account/installation id, or "unattributed-local"
  bucket: string; // "antigravity" | model pool bucket (e.g. "gemini_pro", "gemini_flash", "third_party")
  slot: string; // "five_hour" | "seven_day" | pool-scoped window key
  at: number; // ms epoch when observed
  used: number; // percent used (0–100+, derived from 100 * (1 - remaining_fraction))
  reset: number | null; // epoch seconds
  duration: number | null; // window length in minutes (300 for 5h, 10080 for 7d)
  source: Source;
  session: string | null; // hashed session/conversation id
  version: string | null; // Antigravity CLI/App version
  planTier: string | null; // e.g. "Pro", "Ultra", "Free"
  creditsActive: boolean; // true when Google One AI Credits fallback is active
  flags: string[];
}

/** One allowlisted planner step recorded in an Antigravity local transcript. Never stores prompt/reply text. */
export interface ActivityEvent {
  key: string; // `${surface}:${conversation}:${stepIndex}`
  surface: Surface; // "app" (~/.gemini/antigravity/brain) or "cli" (~/.gemini/antigravity-cli/brain)
  conversation: string; // HMAC-hashed conversation UUID
  at: number; // ms epoch
  model: string; // sanitized model label, e.g. "gemini-4-neon-high"
  input: number; // uncached input tokens
  cacheRead: number; // cached input tokens
  output: number; // output tokens
  tools: string[]; // allowlisted tool names invoked in this step (no arguments)
  subagentCalls: number;
  swarmCalls: number;
  browserCalls: number;
  scheduleCalls: number;
  artifactWrites: number;
  flags: string[];
}

export interface Attempt {
  at: number;
  ok: boolean;
  message: string;
}

export interface FileCursor {
  offset: number;
  inode: string;
  modified: number;
  parser: number;
}
