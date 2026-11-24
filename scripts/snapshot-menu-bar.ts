import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Renders synthetic-only Retina showcase PNGs (menu bar states, Mission Control popovers,
 * and the Prismatic Obsidian web dashboard) by booting an ephemeral synthetic demo server
 * on port 4399 and running macos/Snapshot.swift against it. Zero personal data is ever read.
 */
if (process.platform !== "darwin")
  throw Error("Menu bar & dashboard snapshots require macOS.");

const root = resolve(import.meta.dirname, "..");
const output = process.argv[2] ?? join(root, "docs/public");
const port = process.argv[3] ?? "4399";
const tool = join(root, ".local/menu-bar-snapshots/snapshot");

mkdirSync(output, { recursive: true });
mkdirSync(dirname(tool), { recursive: true });

// 1. Seed fresh synthetic demo store
const seed = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/synthetic-demo.ts", "--seed-only"],
  { cwd: root, stdio: "inherit" },
);
if (seed.status !== 0) process.exit(seed.status ?? 1);

// 2. Compile Snapshot.swift
const compile = spawnSync(
  "/usr/bin/xcrun",
  [
    "swiftc",
    "-D",
    "AGYSCOPE_SNAPSHOT",
    "-target",
    `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos13.0`,
    "-module-cache-path",
    join(root, ".local/swift-module-cache"),
    "macos/AGYScopeModel.swift",
    "macos/HistoryModel.swift",
    "macos/AGYScope.swift",
    "macos/HistoryView.swift",
    "macos/Snapshot.swift",
    "-o",
    tool,
    "-framework",
    "AppKit",
    "-framework",
    "SwiftUI",
    "-framework",
    "WebKit",
  ],
  { cwd: root, stdio: "inherit" },
);
if (compile.status !== 0) process.exit(compile.status ?? 1);

// 3. Boot ephemeral synthetic demo server on `port`
const demoDir = join(root, ".local/demo-data");
const server = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--production"],
  {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: port,
      AGYSCOPE_DATA_DIR: demoDir,
      AGYSCOPE_DEMO: "1",
    },
  },
);

async function waitForReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (res.ok) return;
    } catch {
      /* waiting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Synthetic demo server did not become ready in time.");
}

try {
  await waitForReady();
  const snap = spawnSync(tool, [output, port], { cwd: root, stdio: "inherit" });
  if (snap.status !== 0) process.exit(snap.status ?? 1);
  console.log(`Synthetic showcase visuals written to ${output}`);
} finally {
  server.kill("SIGTERM");
}
