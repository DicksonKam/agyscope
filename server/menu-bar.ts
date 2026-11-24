import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { configuration } from "./config.ts";
import { appInfo, menuBarAgent, menuBarLabel } from "./menu-bar-files.ts";
import { launchAgent, serviceLabel } from "./launch-agent.ts";
import { trashAgent, waitForServiceStop } from "./service-files.ts";

if (process.platform !== "darwin")
  throw Error("The menu bar app requires macOS.");

const root = resolve(import.meta.dirname, "..");
const home = homedir();
const config = configuration(root);
const domain = `gui/${process.getuid!()}`;
const target = `${domain}/${menuBarLabel}`;
const app = join(home, "Applications/AGYScope.app");
const plist = join(home, "Library/LaunchAgents", `${menuBarLabel}.plist`);

function run(bin: string, args: string[], required = true) {
  const result = spawnSync(bin, args, { cwd: root, encoding: "utf8" });
  if (required && result.status !== 0)
    throw Error(
      `${bin} ${args[0]} failed: ${result.stderr || result.error || result.stdout}`,
    );
  return result;
}

const ctl = (args: string[], required = true) =>
  run("/bin/launchctl", args, required);

function recognized() {
  if (
    existsSync(app) &&
    (lstatSync(app).isSymbolicLink() ||
      !readFileSync(join(app, "Contents/Info.plist"), "utf8").includes(
        `<string>${menuBarLabel}</string>`,
      ))
  )
    throw Error(
      "Applications/AGYScope.app is not recognized. It was preserved.",
    );
  if (
    existsSync(plist) &&
    (lstatSync(plist).isSymbolicLink() ||
      readFileSync(plist, "utf8") !== menuBarAgent(app))
  )
    throw Error(
      "Existing menu bar login entry is not recognized. It was preserved.",
    );
}

function build() {
  const builds = join(root, ".local/menu-bar-builds");
  mkdirSync(builds, { recursive: true });
  const buildDir = mkdtempSync(join(builds, "build-"));
  const bundle = join(buildDir, "AGYScope.app");
  const contents = join(bundle, "Contents");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  mkdirSync(join(contents, "Resources"));
  const cache = join(root, ".local/swift-module-cache");

  run("/usr/bin/xcrun", [
    "swiftc",
    "-O",
    "-target",
    `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos13.0`,
    "-module-cache-path",
    cache,
    "macos/AGYScopeModel.swift",
    "macos/HistoryModel.swift",
    "macos/AGYScope.swift",
    "macos/HistoryView.swift",
    "-o",
    join(contents, "MacOS/AGYScope"),
    "-framework",
    "AppKit",
    "-framework",
    "SwiftUI",
  ]);

  const iconset = join(buildDir, "AGYScope.iconset");
  mkdirSync(iconset);
  const iconTool = join(buildDir, "make-icon");
  run("/usr/bin/xcrun", [
    "swiftc",
    "-module-cache-path",
    cache,
    "macos/Icon.swift",
    "-o",
    iconTool,
  ]);
  run(iconTool, [iconset]);
  run("/usr/bin/iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    join(contents, "Resources/AGYScope.icns"),
  ]);

  writeFileSync(join(contents, "Info.plist"), appInfo());
  writeFileSync(
    join(contents, "Resources/connection.json"),
    JSON.stringify({ settingsPath: config.settingsPath, port: config.port }),
  );
  run("/usr/bin/plutil", ["-lint", join(contents, "Info.plist")]);
  run("/usr/bin/codesign", ["--force", "--sign", "-", bundle]);
  run("/usr/bin/codesign", ["--verify", "--strict", bundle]);
  return bundle;
}

async function stop() {
  ctl(["bootout", target], false);
  await waitForServiceStop(() => ctl(["print", target], false).status === 0);
  const info = run(
    "/usr/bin/pgrep",
    [
      "-f",
      `^${app.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/Contents/MacOS/AGYScope$`,
    ],
    false,
  );
  for (const pid of info.stdout.trim().split(/\s+/).filter(Boolean)) {
    if (!/^\d+$/.test(pid)) throw Error("Unexpected process identifier.");
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") continue;
      throw error;
    }
    await waitForServiceStop(() => {
      try {
        process.kill(Number(pid), 0);
        return true;
      } catch {
        return false;
      }
    }, 5000);
  }
}

const command = process.argv[2] ?? "status";
if (command === "build") console.log(build());
else if (command === "install") {
  recognized();
  const bundle = build();
  const trash = join(home, ".Trash");
  if (
    !existsSync(trash) ||
    !lstatSync(trash).isDirectory() ||
    lstatSync(trash).isSymbolicLink()
  )
    throw Error(
      "Trash unavailable; existing app and login entry were preserved.",
    );

  const monitorPlist = join(
    home,
    "Library/LaunchAgents",
    `${serviceLabel}.plist`,
  );
  const expected = launchAgent(root, home, process.execPath, config);
  if (
    !existsSync(monitorPlist) ||
    readFileSync(monitorPlist, "utf8") !== expected
  )
    run(process.execPath, ["--import", "tsx", "server/service.ts", "install"]);
  else run(process.execPath, ["--import", "tsx", "server/service.ts", "start"]);

  mkdirSync(join(home, "Applications"), { recursive: true });
  const stageFolder = mkdtempSync(join(home, "Applications/.agyscope-install-"));
  const stage = join(stageFolder, "AGYScope.app");
  cpSync(bundle, stage, { recursive: true });
  run("/usr/bin/codesign", ["--verify", "--strict", stage]);
  await stop();
  const previous = trashAgent(app, trash);
  try {
    renameSync(stage, app);
  } catch (error) {
    if (previous && !existsSync(app)) renameSync(previous, app);
    throw error;
  }
  trashAgent(stageFolder, trash);
  mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
  if (existsSync(plist)) trashAgent(plist, trash);
  writeFileSync(plist, menuBarAgent(app), { mode: 0o600 });
  run("/usr/bin/plutil", ["-lint", plist]);
  ctl(["enable", target]);
  ctl(["bootstrap", domain, plist]);
  console.log(
    `Installed ${app}. The menu bar and background collector start at login.`,
  );
} else if (command === "uninstall") {
  recognized();
  const trash = join(home, ".Trash");
  if (
    !existsSync(trash) ||
    !lstatSync(trash).isDirectory() ||
    lstatSync(trash).isSymbolicLink()
  )
    throw Error("Trash unavailable; uninstall stopped.");
  await stop();
  for (const file of [plist, app]) {
    const destination = trashAgent(file, trash);
    if (destination) console.log(`Moved to Trash: ${destination}`);
  }
  console.log(
    "Menu bar app removed. Background monitoring, history and settings were preserved. Use npm run service -- uninstall to remove the collector login entry separately.",
  );
} else if (command === "status") {
  const job = ctl(["print", target], false);
  const disabled = ctl(["print-disabled", domain], false)
    .stdout.split("\n")
    .some((line) => line.includes(menuBarLabel) && line.includes("=> true"));
  console.log(
    JSON.stringify(
      {
        app,
        installed: existsSync(app),
        loginEnabled: existsSync(plist) && !disabled,
        loaded: job.status === 0,
        pid: Number(job.stdout.match(/^\s*pid = (\d+)$/m)?.[1]) || null,
      },
      null,
      2,
    ),
  );
} else throw Error("Usage: npm run menubar -- build|install|status|uninstall");
