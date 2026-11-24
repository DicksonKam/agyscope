import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { identityFactory } from "../server/privacy.ts";
import { Store } from "../server/store.ts";
import type { ActivityEvent, Observation } from "../shared/types.ts";

/**
 * Seeds a dedicated synthetic demo database under `.local/demo-data` and launches AGYScope
 * on port 4337 (or PORT) with AGYSCOPE_DEMO=1 so every screen, chart, and menu bar state
 * can be inspected immediately without personal account data.
 */
const root = resolve(import.meta.dirname, "..");
const demoDir = join(root, ".local", "demo-data");
rmSync(demoDir, { recursive: true, force: true });
mkdirSync(demoDir, { recursive: true, mode: 0o700 });
identityFactory(demoDir);

const store = new Store(join(demoDir, "agyscope.sqlite"));
const now = Date.now();
const reset5h = Math.round((now + 2.25 * 3600_000) / 60_000) * 60;
const reset7d = Math.round((now + 3.4 * 86_400_000) / 60_000) * 60;

const obs: Observation[] = [];
// 10 hours of synthetic 5-hour & weekly readings at 10-minute intervals (inside readingGapMs)
// with one genuine 90-minute sleep gap and one clean 5-hour reset.
for (let i = 60; i >= 0; i--) {
  const at = now - i * 600_000;
  if (i >= 34 && i <= 42) continue; // simulated 90-minute sleep gap
  const prevCycle = i > 16;
  const used5h = prevCycle
    ? Math.min(84, Math.max(6, Math.round(6 + (60 - i) * 1.75)))
    : Math.min(24, Math.max(2, Math.round(2 + (16 - i) * 1.15)));
  const r5 = prevCycle ? reset5h - 5 * 3600 : reset5h;
  const used7d = Math.min(38, Math.max(18, Math.round(18 + (60 - i) * 0.3)));

  obs.push(
    {
      account: "demo-account",
      bucket: "antigravity",
      slot: "five_hour",
      at,
      used: used5h,
      reset: r5,
      duration: 300,
      source: "demo",
      session: null,
      version: "2.0.0-demo",
      planTier: "Ultra",
      creditsActive: false,
      flags: [],
    },
    {
      account: "demo-account",
      bucket: "antigravity",
      slot: "seven_day",
      at,
      used: used7d,
      reset: reset7d,
      duration: 10080,
      source: "demo",
      session: null,
      version: "2.0.0-demo",
      planTier: "Ultra",
      creditsActive: false,
      flags: [],
    },
    {
      account: "demo-account",
      bucket: "gemini_argon",
      slot: "seven_day",
      at,
      used: Math.max(2, Math.round(used7d * 0.2)),
      reset: reset7d,
      duration: 10080,
      source: "demo",
      session: null,
      version: "2.0.0-demo",
      planTier: "Ultra",
      creditsActive: false,
      flags: [],
    },
    {
      account: "demo-account",
      bucket: "third_party",
      slot: "five_hour",
      at,
      used: Math.max(4, Math.round(used5h * 0.4)),
      reset: r5,
      duration: 300,
      source: "demo",
      session: null,
      version: "2.0.0-demo",
      planTier: "Ultra",
      creditsActive: false,
      flags: [],
    },
    {
      account: "demo-account",
      bucket: "third_party",
      slot: "seven_day",
      at,
      used: Math.min(50, Math.round(used7d * 0.82)),
      reset: reset7d,
      duration: 10080,
      source: "demo",
      session: null,
      version: "2.0.0-demo",
      planTier: "Ultra",
      creditsActive: false,
      flags: [],
    },
  );
}

const sampleModels = [
  "gemini-4-neon-high",
  "gemini-4-argon-medium",
  "gemini-3-flash",
];
const sampleTools = [
  ["read_file", "edit_file"],
  ["run_command"],
  ["invoke_subagent", "read_file"],
  ["swarm", "write_file"],
  ["search_web", "write_file"],
];

const events: ActivityEvent[] = [];
for (let i = 0; i < 42; i++) {
  const recent = i < 14;
  const at = recent
    ? now - i * 9 * 60_000
    : now - (6 + i) * 40 * 60_000;
  const conv = `demo000${(i % 6) + 1}`;
  const tools = sampleTools[i % sampleTools.length];
  events.push({
    key: `demo:${conv}:${i}`,
    surface: i % 4 === 0 ? "cli" : "app",
    conversation: conv,
    at,
    model: sampleModels[i % sampleModels.length],
    input: 2400 + (i % 5) * 900,
    cacheRead: 18_000 + (i % 7) * 4500,
    output: 650 + (i % 6) * 420,
    tools,
    subagentCalls: tools.includes("invoke_subagent") ? 1 : 0,
    swarmCalls: tools.includes("swarm") ? 1 : 0,
    browserCalls: i % 7 === 0 ? 1 : 0,
    scheduleCalls: i % 15 === 0 ? 1 : 0,
    artifactWrites: tools.includes("write_file") ? 1 : 0,
    flags: [],
  });
}

store.transaction(() => {
  for (const o of obs) store.observe(o);
  for (const e of events) store.recordEvent(e);
  store.set("scan", {
    at: now - 12_000,
    files: 18,
    changed: 3,
    bytes: 482_000,
    elapsedMs: 28,
    failed: 0,
    complete: true,
  });
  store.attempt({
    at: now,
    ok: true,
    message: "Synthetic demo: seeded 5h, weekly, and model pool telemetry",
  });
});
store.close();

if (process.argv.includes("--seed-only")) {
  console.log(`Seeded synthetic demo store at ${demoDir}`);
  process.exit(0);
}

const child = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--production"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      AGYSCOPE_DATA_DIR: demoDir,
      AGYSCOPE_DEMO: "1",
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
