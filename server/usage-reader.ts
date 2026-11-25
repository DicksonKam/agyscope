import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { accessSync, constants, existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { CliReads, CliReadState } from "../shared/api.ts";
import type { Observation } from "../shared/types.ts";
import { slotRank } from "../shared/allowance.ts";
import { integer, label, numeric } from "./privacy.ts";
import { normalizeQuotaKey, roundResetSeconds } from "./statusline.ts";
import type { Store } from "./store.ts";

/**
 * Official Antigravity CLI (`agy`) zero-token usage reader.
 * AGYScope never reads, stores, or renews Google credentials and never contacts Google endpoints directly.
 *
 * Root-level anti-popup & safety invariants (independent of failure cause — DNS, expired token,
 * locked Keychain, VPN, firewall, or server error):
 * 1. Pre-flight DNS check skips spawning `agy` altogether while offline or DNS is broken.
 * 2. Spawns `agy` by resolved absolute path with a stripped environment (`PATH=""`, `NO_BROWSER=1`,
 *    `BROWSER=""`, `CI=true`, `NONINTERACTIVE=1`) so PATH-resolved browser launchers (`open`) cannot run.
 * 3. Preemptive 8-second silent-auth watchdog on an ephemeral `--log-file`: if `agy` logs
 *    `trying silent auth` and has not logged `silent auth succeeded` within 8s, AGYScope terminates it
 *    2 seconds BEFORE `agy`'s 10s `keyringAuth` timeout can fall back to interactive OAuth.
 * 4. Immediate OAuth killswitch + persistent circuit breaker (`cliAuthPaused` in SQLite): any
 *    `silent auth failed` / `triggering interactive OAuth` or 3 consecutive non-offline failures pause
 *    background CLI polling completely until the user explicitly clicks Refresh or re-enables CLI checks.
 * 5. Zero-token guard: if `agy` ever spends tokens or cost answering `/usage`, reads stop permanently.
 */
export function usageArguments(logFile?: string): string[] {
  const args: string[] = [];
  if (logFile) args.push("--log-file", logFile);
  args.push("-p", "/usage", "--output-format", "json", "--print-timeout", "20s");
  return args;
}

/** Resolve an executable name to an absolute path so we can spawn it safely with `PATH=""`. */
export function resolveExecutable(
  executable: string,
  envPath = process.env.PATH ?? "",
  home = homedir(),
): string {
  if (isAbsolute(executable) || executable.includes("/")) return executable;
  const searchDirs = [
    ...envPath.split(":").filter(Boolean),
    join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of [...new Set(searchDirs)]) {
    const candidate = join(dir, executable);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Continue searching. */
    }
  }
  return executable;
}

/** Stripped headless environment for `agy`: keeps user home/tmp for keyring IPC, removes PATH & browser hooks. */
export function headlessChildEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: "",
    NO_BROWSER: "1",
    BROWSER: "",
    CI: "true",
    NONINTERACTIVE: "1",
  };
  for (const key of [
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "no_proxy",
  ]) {
    if (base[key] !== undefined) env[key] = base[key];
  }
  return env;
}

export interface CliUsageReading {
  windows: {
    bucket: string;
    slot: string;
    duration: number | null;
    used: number;
    reset: number | null;
  }[];
  planTier: string | null;
  creditsActive: boolean;
  turns: number;
  tokens: number;
  costUsd: number;
  available: boolean;
  text: string;
}

export function parseCliUsageReport(
  stdout: string,
  nowMs = Date.now(),
): CliUsageReading | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const reading: CliUsageReading = {
    windows: [],
    planTier: null,
    creditsActive: false,
    turns: 0,
    tokens: 0,
    costUsd: 0,
    available: false,
    text: "",
  };

  const items: Record<string, unknown>[] = Array.isArray(parsed)
    ? (parsed as Record<string, unknown>[])
    : [parsed as Record<string, unknown>];

  for (const m of items) {
    if (!m || typeof m !== "object") continue;
    if (typeof m.plan_tier === "string") reading.planTier = label(m.plan_tier);
    if (m.credits_active === true) reading.creditsActive = true;
    if (typeof m.result === "string") reading.text = m.result.slice(0, 500);

    const turns = integer(m.num_turns);
    if (turns !== null) reading.turns = Math.max(reading.turns, turns);
    const cost = numeric(m.total_cost_usd);
    if (cost !== null) reading.costUsd = Math.max(reading.costUsd, cost);

    const usage = m.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage === "object") {
      reading.tokens += [
        "input_tokens",
        "output_tokens",
        "thinking_tokens",
        "cache_read_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
        "total_tokens",
      ].reduce((sum, k) => sum + (integer(usage[k]) ?? 0), 0);
    }

    // 1. Official agy 1.5+ `/usage` JSON shape: command.data.groups[].buckets[]
    const cmd = m.command as
      | { name?: unknown; data?: { groups?: unknown } }
      | undefined;
    if (cmd && typeof cmd === "object" && Array.isArray(cmd.data?.groups)) {
      reading.available = true;
      for (const group of cmd.data.groups as Record<string, unknown>[]) {
        if (!group || !Array.isArray(group.buckets)) continue;
        for (const b of group.buckets as Record<string, unknown>[]) {
          if (!b || typeof b !== "object") continue;
          const id = typeof b.id === "string" ? b.id : "";
          const win = typeof b.window === "string" ? b.window : "";
          const mapped = normalizeQuotaKey(id || win);
          if (!mapped) continue;
          const remFrac = numeric(b.remaining_fraction);
          const usedPct = numeric(b.used_percentage);
          let used: number | null = null;
          if (remFrac !== null && remFrac >= 0 && remFrac <= 1.05)
            used = Math.round((1 - Math.min(1, remFrac)) * 1000) / 10;
          else if (usedPct !== null && usedPct >= 0)
            used = Math.round(usedPct * 10) / 10;
          if (used === null) continue;
          const reset =
            roundResetSeconds(b.reset_time, nowMs) ??
            roundResetSeconds(b.reset_in_seconds, nowMs);
          reading.windows.push({ ...mapped, used, reset });
        }
      }
    }

    // 2. Flat quota map shape (statusLine / alternative schemas)
    const quotaObj =
      (m.quota as Record<string, unknown> | undefined) ??
      ((m.usage_report as Record<string, unknown> | undefined)?.quota as
        | Record<string, unknown>
        | undefined);
    if (quotaObj && typeof quotaObj === "object" && !Array.isArray(quotaObj)) {
      reading.available = true;
      for (const [key, entry] of Object.entries(
        quotaObj as Record<string, Record<string, unknown>>,
      )) {
        if (!entry || typeof entry !== "object") continue;
        const mapped = normalizeQuotaKey(key);
        if (!mapped) continue;
        const remFrac = numeric(entry.remaining_fraction);
        const usedPct = numeric(entry.used_percentage);
        const remPct = numeric(entry.remaining_percentage);
        let used: number | null = null;
        if (remFrac !== null && remFrac >= 0 && remFrac <= 1.05)
          used = Math.round((1 - Math.min(1, remFrac)) * 1000) / 10;
        else if (usedPct !== null && usedPct >= 0)
          used = Math.round(usedPct * 10) / 10;
        else if (remPct !== null && remPct >= 0 && remPct <= 100)
          used = Math.round((100 - remPct) * 10) / 10;
        if (used === null) continue;
        const reset =
          roundResetSeconds(entry.reset_time, nowMs) ??
          roundResetSeconds(entry.reset_in_seconds, nowMs);
        reading.windows.push({ ...mapped, used, reset });
      }
    }
  }

  return reading;
}

export function cliObservations(
  reading: CliUsageReading,
  account: string,
  at: number,
): Observation[] {
  const weeklyCapped = reading.windows.some(
    (w) => w.slot === "seven_day" && w.used >= 100,
  );
  return reading.windows.map((w) => {
    const flags: string[] = [];
    if (w.used > 100) flags.push("over-100");
    if (reading.creditsActive) flags.push("credits-fallback");
    if (weeklyCapped && w.slot === "five_hour") flags.push("weekly-cap-active");
    return {
      account,
      bucket: w.bucket,
      slot: w.slot,
      at,
      used: w.used,
      reset: w.reset,
      duration: w.duration,
      source: "cli",
      session: null,
      version: null,
      planTier: reading.planTier,
      creditsActive: reading.creditsActive,
      flags,
    };
  });
}

export interface CliCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  authTriggered?: boolean;
  silentAuthTimedOut?: boolean;
  networkError?: boolean;
}

export type CliCommand = () => Promise<CliCommandResult>;
export type NetworkPreflight = () => Promise<boolean>;

const tryingSilentAuthPattern = /trying silent auth/i;
const silentAuthSucceededPattern = /silent auth succeeded/i;
const interactiveOAuthPattern =
  /triggering interactive oauth|starting oauth authentication flow|consumeroauth: starting oauth flow|silent auth failed/i;
const networkErrorPattern =
  /i\/o timeout|no such host|dial tcp|enotfound|eai_again|network is unreachable|connection refused|keyringauth: timed out/i;
const signedOutPattern =
  /not logged in|not signed in|please sign in|authenticate|login required|unauthenticated|triggering interactive oauth/i;

/** Lightweight DNS pre-flight check so AGYScope never spawns `agy` while DNS or network is down. */
export async function defaultNetworkPreflight(
  timeoutMs = 2500,
): Promise<boolean> {
  const resolveWithTimeout = (host: string) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, timeoutMs);
      timer.unref();
      lookup(host)
        .then(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(true);
          }
        })
        .catch(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(false);
          }
        });
    });
  const [a, b] = await Promise.all([
    resolveWithTimeout("antigravity.google"),
    resolveWithTimeout("oauth2.googleapis.com"),
  ]);
  return a && b;
}

export function cliCommand(
  executable: string,
  cwd: string,
  logDir = cwd,
  timeoutMs = 22_000,
  silentAuthDeadlineMs = 8_000,
): CliCommand {
  return () =>
    new Promise((resolve, reject) => {
      const resolvedBin = resolveExecutable(executable);
      const logFile = join(logDir, "agy-usage-last.log");
      try {
        if (existsSync(logFile)) unlinkSync(logFile);
      } catch {
        /* Ignore stale temp log cleanup errors. */
      }

      const child = spawn(resolvedBin, usageArguments(logFile), {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: headlessChildEnv(),
      });
      let stdout = "";
      let stderr = "";
      let authTriggered = false;
      let silentAuthTimedOut = false;
      let networkError = false;
      let killed = false;
      let silentAuthStartedAt: number | null = null;

      const terminateChild = () => {
        if (killed) return;
        killed = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 1500).unref();
      };

      const inspectLog = () => {
        try {
          if (!existsSync(logFile)) return;
          const text = readFileSync(logFile, "utf8");
          if (networkErrorPattern.test(text)) networkError = true;
          if (interactiveOAuthPattern.test(text)) {
            authTriggered = true;
            terminateChild();
            return;
          }
          if (silentAuthSucceededPattern.test(text)) {
            silentAuthStartedAt = null;
          } else if (tryingSilentAuthPattern.test(text)) {
            if (silentAuthStartedAt === null) silentAuthStartedAt = Date.now();
            // Preempt agy's 10s keyringAuth timeout so it can never fall back to interactive OAuth.
            if (Date.now() - silentAuthStartedAt >= silentAuthDeadlineMs) {
              silentAuthTimedOut = true;
              terminateChild();
            }
          }
        } catch {
          /* Log file may still be opening. */
        }
      };

      const watcher = setInterval(inspectLog, 250);
      watcher.unref();

      child.stdout.on("data", (d) => {
        if (stdout.length < 2_000_000) stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        if (stderr.length < 4000) stderr += String(d);
        if (interactiveOAuthPattern.test(stderr)) {
          authTriggered = true;
          terminateChild();
        }
      });

      const timer = setTimeout(() => {
        inspectLog();
        terminateChild();
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(watcher);
        inspectLog();
        try {
          if (existsSync(logFile)) unlinkSync(logFile);
        } catch {
          /* Best-effort cleanup of ephemeral per-run log. */
        }
      };

      child.on("error", (e) => {
        cleanup();
        reject(e);
      });
      child.on("close", (code) => {
        cleanup();
        if (networkErrorPattern.test(stderr)) networkError = true;
        resolve({
          code,
          stdout,
          stderr,
          authTriggered,
          silentAuthTimedOut,
          networkError,
        });
      });
    });
}

export const nextBackoff = (previousMs: number | null) =>
  Math.min(900_000, previousMs ? previousMs * 2 : 60_000);

/** Max consecutive non-offline CLI errors before automatically pausing to prevent any background loop. */
export const maxConsecutiveFailures = 3;

export class CliUsageReader {
  private backoffMs: number | null = null;
  private backoffUntil: number | null = null;
  private consecutiveFailures = 0;
  private flight: Promise<boolean> | null = null;
  private stopped: string | null = null;
  private available = true;

  constructor(
    private store: Store,
    private run: CliCommand,
    private executable: string,
    private account: () => string,
    private enabled: () => boolean,
    private preflight: NetworkPreflight = defaultNetworkPreflight,
  ) {}

  private isAuthPaused(): boolean {
    return this.store.get<boolean>("cliAuthPaused") === true;
  }

  /** Clear the pause circuit breaker (called when the user manually refreshes or re-enables CLI checks). */
  resetPause() {
    this.store.set("cliAuthPaused", false);
    this.consecutiveFailures = 0;
    this.backoffMs = null;
    this.backoffUntil = null;
  }

  state(now = Date.now()): CliReads {
    const saved = this.store.get<Partial<CliReads>>("cliReads") ?? {};
    const state: CliReadState = !this.enabled()
      ? "off"
      : !this.available
        ? "unavailable"
        : this.stopped
          ? "stopped"
          : this.isAuthPaused()
            ? "signed-out"
            : ((saved.state as CliReadState) ?? "unavailable");
    return {
      enabled: this.enabled(),
      available: this.available,
      executable: this.executable,
      state,
      lastOkAt: saved.lastOkAt ?? null,
      lastAttemptAt: saved.lastAttemptAt ?? null,
      lastError: this.stopped ?? saved.lastError ?? null,
      backoffUntil:
        !this.isAuthPaused() &&
        this.backoffUntil !== null &&
        this.backoffUntil > now
          ? this.backoffUntil
          : null,
      count: saved.count ?? 0,
      lastDurationMs: saved.lastDurationMs ?? null,
    };
  }

  private save(patch: Partial<CliReads>) {
    this.store.set("cliReads", {
      ...(this.store.get<Partial<CliReads>>("cliReads") ?? {}),
      ...patch,
    });
  }

  private pauseForAuth(now: number, error: string) {
    this.store.set("cliAuthPaused", true);
    this.consecutiveFailures = 0;
    this.backoffMs = null;
    this.backoffUntil = null;
    this.save({ state: "signed-out", lastAttemptAt: now, lastError: error });
    this.store.attempt({
      at: now,
      ok: false,
      message: `CLI read paused: ${error}`,
    });
    return false;
  }

  private fail(now: number, state: CliReadState, error: string) {
    if (state !== "offline" && state !== "unavailable") {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= maxConsecutiveFailures) {
        return this.pauseForAuth(
          now,
          `Paused after ${maxConsecutiveFailures} consecutive CLI failures (${error}). Click Refresh now to resume.`,
        );
      }
    }
    this.backoffMs = nextBackoff(this.backoffMs);
    this.backoffUntil = now + this.backoffMs;
    this.save({ state, lastAttemptAt: now, lastError: error });
    if (state !== "unavailable" && state !== "offline") {
      this.store.attempt({ at: now, ok: false, message: `CLI read: ${error}` });
    }
    return false;
  }

  /**
   * One read, single-flight. Pass `manual = true` from an explicit user Refresh action
   * to bypass backoff and clear the pause circuit breaker for one attempt.
   */
  read(now = Date.now(), manual = false): Promise<boolean> {
    if (this.flight) return this.flight;
    this.flight = this.execute(now, manual).finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  private async execute(now: number, manual: boolean): Promise<boolean> {
    if (!this.enabled() || this.stopped) return false;
    if (manual) {
      this.resetPause();
    } else {
      if (this.isAuthPaused()) return false;
      if (this.backoffUntil !== null && this.backoffUntil > now) return false;
    }

    // Layer 1: Never launch `agy` while offline or DNS is broken.
    const online = await this.preflight().catch(() => false);
    if (!online) {
      this.backoffMs = Math.min(
        300_000,
        this.backoffMs ? this.backoffMs * 2 : 60_000,
      );
      this.backoffUntil = now + this.backoffMs;
      this.save({
        state: "offline",
        lastAttemptAt: now,
        lastError:
          "Offline or DNS unavailable — skipped agy check until network recovers",
      });
      return false;
    }

    let result: CliCommandResult;
    try {
      result = await this.run();
      this.available = true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.available = false;
        this.backoffMs = 300_000;
        this.backoffUntil = now + this.backoffMs;
        this.save({
          state: "unavailable",
          lastAttemptAt: now,
          lastError: `Antigravity CLI (${this.executable}) not found; install agy or set AGYSCOPE_AGY`,
        });
        return false;
      }
      return this.fail(
        now,
        "error",
        `could not start Antigravity CLI (${(e as Error).message})`,
      );
    }

    // Layer 3 & 4: Preemptive silent-auth timeout or explicit OAuth fallback -> trip circuit breaker immediately.
    if (result.authTriggered) {
      return this.pauseForAuth(
        now,
        "Antigravity sign-in needed; CLI checks paused to prevent browser popups. Run agy once, then click Refresh now.",
      );
    }
    if (result.silentAuthTimedOut) {
      if (result.networkError) {
        return this.fail(
          now,
          "offline",
          "Silent auth timed out due to network/DNS — stopped before interactive sign-in",
        );
      }
      return this.pauseForAuth(
        now,
        "Silent auth timed out (stopped before browser sign-in could open). Check network/Keychain, then click Refresh now.",
      );
    }

    const reading = parseCliUsageReport(result.stdout, now);
    // Strict zero-cost invariant: never spend model tokens polling usage.
    if (
      reading &&
      (reading.turns > 0 || reading.tokens > 0 || reading.costUsd > 0)
    ) {
      this.stopped = `Antigravity CLI spent model tokens answering /usage (${reading.tokens} tokens), so CLI reads stopped automatically.`;
      this.save({
        state: "stopped",
        lastAttemptAt: now,
        lastError: this.stopped,
      });
      this.store.attempt({
        at: now,
        ok: false,
        message: `CLI read: ${this.stopped}`,
      });
      return false;
    }

    if (!reading) {
      if (result.networkError) {
        return this.fail(
          now,
          "offline",
          "Network or DNS error while checking usage — waiting to reconnect",
        );
      }
      if (signedOutPattern.test(result.stderr)) {
        return this.pauseForAuth(
          now,
          "Antigravity CLI is not signed in; CLI checks paused to prevent popups. Run agy once, then click Refresh now.",
        );
      }
      return this.fail(
        now,
        "error",
        `Antigravity CLI exited ${result.code} without a structured quota report`,
      );
    }

    if (!reading.available || !reading.windows.length) {
      if (signedOutPattern.test(reading.text)) {
        return this.pauseForAuth(
          now,
          "Antigravity CLI is not signed in; CLI checks paused to prevent popups. Run agy once, then click Refresh now.",
        );
      }
      if (result.networkError) {
        return this.fail(
          now,
          "offline",
          "Network or DNS timeout while fetching quota — waiting to reconnect",
        );
      }
      return this.fail(
        now,
        "rate-limited",
        "Antigravity CLI did not return quota data; retrying",
      );
    }

    const obs = cliObservations(reading, this.account(), now);
    for (const o of obs) this.store.observe(o);
    this.store.set("cliAuthPaused", false);
    this.consecutiveFailures = 0;
    this.backoffMs = null;
    this.backoffUntil = null;
    const saved = this.store.get<Partial<CliReads>>("cliReads") ?? {};
    this.save({
      state: "ok",
      lastOkAt: now,
      lastAttemptAt: now,
      lastError: null,
      count: (saved.count ?? 0) + 1,
      lastDurationMs: Date.now() - now,
    });
    const summary = [...reading.windows]
      .sort((a, b) => slotRank(a.slot) - slotRank(b.slot))
      .map((w) => `${w.slot} ${Math.round(100 - w.used)}% left`)
      .join(" · ");
    this.store.attempt({
      at: now,
      ok: true,
      message: `CLI read: ${summary}`,
    });
    return true;
  }
}
