import { spawn } from "node:child_process";
import type { CliReads, CliReadState } from "../shared/api.ts";
import type { Observation } from "../shared/types.ts";
import { slotRank } from "../shared/allowance.ts";
import { integer, label, numeric } from "./privacy.ts";
import { normalizeQuotaKey, roundResetSeconds } from "./statusline.ts";
import type { Store } from "./store.ts";

/**
 * Official Antigravity CLI (`agy`) zero-token usage reader.
 * AGYScope never reads, stores, or renews Google credentials and never contacts Google endpoints directly.
 * If the CLI ever reports model tokens or cost for a usage check, reads immediately stop by themselves.
 */
export function usageArguments(): string[] {
  return ["-p", "/usage", "--output-format", "json", "--print-timeout", "25s"];
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
    if (
      cmd &&
      typeof cmd === "object" &&
      Array.isArray(cmd.data?.groups)
    ) {
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

export type CliCommand = () => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;

export function cliCommand(
  executable: string,
  cwd: string,
  timeoutMs = 30_000,
): CliCommand {
  return () =>
    new Promise((resolve, reject) => {
      const child = spawn(executable, usageArguments(), {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        if (stdout.length < 2_000_000) stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        if (stderr.length < 4000) stderr += String(d);
      });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      }, timeoutMs);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
}

export const nextBackoff = (previousMs: number | null) =>
  Math.min(900_000, previousMs ? previousMs * 2 : 60_000);

const signedOutPattern =
  /not logged in|please sign in|authenticate|login required|unauthenticated/i;

export class CliUsageReader {
  private backoffMs: number | null = null;
  private backoffUntil: number | null = null;
  private flight: Promise<boolean> | null = null;
  private stopped: string | null = null;
  private available = true;

  constructor(
    private store: Store,
    private run: CliCommand,
    private executable: string,
    private account: () => string,
    private enabled: () => boolean,
  ) {}

  state(now = Date.now()): CliReads {
    const saved = this.store.get<Partial<CliReads>>("cliReads") ?? {};
    const state: CliReadState = !this.enabled()
      ? "off"
      : !this.available
        ? "unavailable"
        : this.stopped
          ? "stopped"
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
        this.backoffUntil !== null && this.backoffUntil > now
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

  private fail(now: number, state: CliReadState, error: string) {
    this.backoffMs = nextBackoff(this.backoffMs);
    this.backoffUntil = now + this.backoffMs;
    this.save({ state, lastAttemptAt: now, lastError: error });
    if (state !== "unavailable") {
      this.store.attempt({ at: now, ok: false, message: `CLI read: ${error}` });
    }
    return false;
  }

  read(now = Date.now()): Promise<boolean> {
    if (this.flight) return this.flight;
    this.flight = this.execute(now).finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  private async execute(now: number): Promise<boolean> {
    if (!this.enabled() || this.stopped) return false;
    if (this.backoffUntil !== null && this.backoffUntil > now) return false;
    let result: Awaited<ReturnType<CliCommand>>;
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
      if (signedOutPattern.test(result.stderr))
        return this.fail(
          now,
          "signed-out",
          "Antigravity CLI is not signed in; run agy once in a terminal",
        );
      return this.fail(
        now,
        "error",
        `Antigravity CLI exited ${result.code} without a structured quota report`,
      );
    }

    if (!reading.available || !reading.windows.length) {
      if (signedOutPattern.test(reading.text))
        return this.fail(
          now,
          "signed-out",
          "Antigravity CLI is not signed in; run agy once in a terminal",
        );
      return this.fail(
        now,
        "rate-limited",
        "Antigravity CLI did not return quota data; retrying",
      );
    }

    const obs = cliObservations(reading, this.account(), now);
    for (const o of obs) this.store.observe(o);
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
