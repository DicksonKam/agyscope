import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("Skipping native macOS tests on non-macOS host.");
  process.exit(0);
}

const root = resolve(import.meta.dirname, "..");
const cache = join(root, ".local/swift-module-cache");
const tmpBase = join(root, ".local/test-macos");
mkdirSync(tmpBase, { recursive: true });
const dir = mkdtempSync(join(tmpBase, "run-"));
const bin = join(dir, "model-tests");

try {
  const compile = spawnSync(
    "/usr/bin/xcrun",
    [
      "swiftc",
      "-target",
      `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos13.0`,
      "-module-cache-path",
      cache,
      "macos/AGYScopeModel.swift",
      "macos/HistoryModel.swift",
      "macos/ModelTests.swift",
      "-o",
      bin,
      "-framework",
      "AppKit",
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (compile.status !== 0) process.exit(compile.status ?? 1);

  const run = spawnSync(bin, [], { cwd: root, stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
