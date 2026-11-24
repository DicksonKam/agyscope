import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { configuration } from "./config.ts";
import { launchAgent, serviceLabel } from "./launch-agent.ts";
import { trashAgent, waitForServiceStop } from "./service-files.ts";

if (process.platform !== "darwin")
  throw Error("The login service requires macOS.");

const root = resolve(import.meta.dirname, "..");
const home = homedir();
const config = configuration(root);
const domain = `gui/${process.getuid!()}`;
const target = `${domain}/${serviceLabel}`;
const plist = join(home, "Library/LaunchAgents", `${serviceLabel}.plist`);

function run(bin: string, args: string[], required = true) {
  const res = spawnSync(bin, args, { cwd: root, encoding: "utf8" });
  if (required && res.status !== 0)
    throw Error(
      `${bin} ${args[0]} failed: ${res.stderr || res.error || res.stdout}`,
    );
  return res;
}

const ctl = (args: string[], required = true) =>
  run("/bin/launchctl", args, required);

function recognized() {
  if (
    existsSync(plist) &&
    (lstatSync(plist).isSymbolicLink() ||
      !readFileSync(plist, "utf8").includes(`<string>${serviceLabel}</string>`))
  )
    throw Error("Existing service login entry is not recognized. Preserved.");
}

async function unload() {
  ctl(["bootout", target], false);
  await waitForServiceStop(() => ctl(["print", target], false).status === 0);
}

const cmd = process.argv[2] ?? "status";
if (cmd === "install") {
  recognized();
  mkdirSync(join(config.dataDir, "service"), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
  await unload();
  const trash = join(home, ".Trash");
  if (existsSync(plist)) trashAgent(plist, trash);
  writeFileSync(plist, launchAgent(root, home, process.execPath, config), {
    mode: 0o600,
  });
  run("/usr/bin/plutil", ["-lint", plist]);
  ctl(["enable", target]);
  ctl(["bootstrap", domain, plist]);
  console.log(
    `Installed ${serviceLabel}. AGYScope service runs at http://127.0.0.1:${config.port}.`,
  );
} else if (cmd === "start") {
  if (!existsSync(plist))
    throw Error("Service is not installed. Run npm run service -- install.");
  ctl(["enable", target]);
  if (ctl(["print", target], false).status !== 0)
    ctl(["bootstrap", domain, plist]);
  else ctl(["kickstart", "-k", target]);
  console.log(`Started ${serviceLabel}.`);
} else if (cmd === "stop") {
  await unload();
  console.log(`Stopped ${serviceLabel}.`);
} else if (cmd === "uninstall") {
  recognized();
  await unload();
  const dest = trashAgent(plist, join(home, ".Trash"));
  if (dest) console.log(`Moved to Trash: ${dest}`);
  console.log("AGYScope service login entry removed. History was preserved.");
} else if (cmd === "status") {
  const job = ctl(["print", target], false);
  const disabled = ctl(["print-disabled", domain], false)
    .stdout.split("\n")
    .some((line) => line.includes(serviceLabel) && line.includes("=> true"));
  console.log(
    JSON.stringify(
      {
        label: serviceLabel,
        installed: existsSync(plist),
        loginEnabled: existsSync(plist) && !disabled,
        loaded: job.status === 0,
        pid: Number(job.stdout.match(/^\s*pid = (\d+)$/m)?.[1]) || null,
        port: config.port,
      },
      null,
      2,
    ),
  );
} else {
  throw Error("Usage: npm run service -- install|start|stop|status|uninstall");
}
