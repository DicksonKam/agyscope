import type { Attempt, Observation, Surface } from "./types.ts";
import type { Coverage } from "./monitoring.ts";

export interface CollectorState {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  failures: number;
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
  nextRunAt: number | null;
  lastError: string | null;
  failureSince: number | null;
  recoveredAt: number | null;
}

export interface TapState {
  installed: boolean;
  present: boolean;
  latestAt: number | null;
  lines: number;
}

export interface ScanState {
  at: number;
  files: number;
  changed: number;
  bytes: number;
  elapsedMs: number;
  failed: number;
  complete: boolean;
}

export interface ActivityState {
  lastAt: number | null;
  sinceReading: boolean;
}

export type CliReadState =
  | "off"
  | "unavailable"
  | "offline"
  | "ok"
  | "signed-out"
  | "rate-limited"
  | "stopped"
  | "error";

export interface CliReads {
  enabled: boolean;
  available: boolean;
  executable: string;
  state: CliReadState;
  lastOkAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  backoffUntil: number | null;
  count: number;
  lastDurationMs: number | null;
}

export interface AccountState {
  account: string;
  planTier: string | null;
  useG1Credits: boolean | null;
  creditsActive: boolean;
  cli: CliReads;
}

/** Compact Antigravity work metrics for both the Mission Control popover and the Agents & Work page. */
export interface WorkBucket {
  conversations: number;
  responses: number;
  subagents: number;
  swarms: number;
  browserRuns: number;
  scheduledTasks: number;
  artifacts: number;
  input: number;
  cacheRead: number;
  output: number;
  lastAt: number | null;
}

export interface ModelBreakdown {
  model: string;
  responses: number;
  input: number;
  cacheRead: number;
  output: number;
  lastAt: number;
}

export interface SurfaceBreakdown {
  surface: Surface;
  conversations: number;
  responses: number;
  output: number;
}

export interface ToolCount {
  name: string;
  count: number;
}

export interface RecentConversation {
  id: string; // hashed short identifier
  surface: Surface;
  lastAt: number;
  responses: number;
  subagents: number;
  swarms: number;
  browserRuns: number;
  artifacts: number;
  topModel: string;
}

export interface DashboardQuery {
  days?: 7 | 30 | 90;
  historyScope?: "range" | "current";
  window?: string;
  timezone?: string;
}

export interface CycleInfo {
  available: boolean;
  from: number | null;
  reset: number | null;
  reason: string;
}

/** Lightweight status read: fast enough for the menu bar every 15 seconds. */
export interface DashboardStatus {
  version: number;
  csrf: string;
  now: number;
  demo: boolean;
  collector: CollectorState & { managed: boolean };
  tap: TapState;
  scan: ScanState | null;
  account: AccountState;
  activity: ActivityState;
  window5h: WorkBucket;
  attempts: Attempt[];
  windows: Observation[];
}

export interface DashboardDetails {
  latest?: Observation;
  cycle: CycleInfo;
  history: Observation[];
  historyTruncated: boolean;
  coverage: Coverage;
  totals: WorkBucket;
  models: ModelBreakdown[];
  surfaces: SurfaceBreakdown[];
  tools: ToolCount[];
  recentConversations: RecentConversation[];
  issues: { code: string; count: number }[];
  query: DashboardQuery;
}

export type DashboardResponse = DashboardStatus & DashboardDetails;
export type DashboardState = DashboardStatus &
  Partial<DashboardDetails> & { detailsDelayed?: boolean };
export type ActionResponse =
  | (DashboardStatus & { message?: string; error?: string })
  | { version?: undefined; message?: string; error?: string };
