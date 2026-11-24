import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configuration } from "../server/config.ts";
import { installTap, status, uninstallTap } from "../server/tap.ts";

test("tap install backs up existing settings, chains prior statusLine, and uninstall restores cleanly", () => {
  const dir = mkdtempSync(join(tmpdir(), "agyscope-tap-"));
  try {
    const config = configuration(
      resolve(import.meta.dirname, ".."),
      {
        AGYSCOPE_APP_SUPPORT: join(dir, "support"),
        AGYSCOPE_CLI_DIR: join(dir, "cli"),
        AGYSCOPE_APP_DIR: join(dir, "app"),
      },
      dir,
    );
    const prevSettings = {
      trustedWorkspaces: ["/tmp/demo"],
      statusLine: { type: "command", command: "echo custom", enabled: true },
    };
    const settingsDir = join(dir, "cli");
    installTap(config);
    // Re-test with an existing statusLine present
    uninstallTap(config);
    writeFileSync(
      join(settingsDir, "settings.json"),
      JSON.stringify(prevSettings),
    );
    const afterInstall = installTap(config);
    assert.equal(afterInstall.installed, true);
    assert.equal(afterInstall.chainedCommand, "echo custom");

    const installedSettings = JSON.parse(
      readFileSync(config.agyCliSettingsPath, "utf8"),
    );
    assert.ok(installedSettings.statusLine.command.includes(config.tapScript));

    const afterUninstall = uninstallTap(config);
    assert.equal(afterUninstall.installed, false);
    const restored = JSON.parse(readFileSync(config.agyCliSettingsPath, "utf8"));
    assert.equal(restored.statusLine.command, "echo custom");
    assert.equal(status(config).installed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
