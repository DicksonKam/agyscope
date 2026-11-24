import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { configuration } from "./config.ts";
import { status as tapStatus } from "./tap.ts";

const config = configuration();
const dbPath = join(config.dataDir, "agyscope.sqlite");

async function checkService() {
  const started = Date.now();
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/api/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { reachable: false, status: res.status };
    const body = (await res.json()) as {
      windows: unknown[];
      window5h?: { conversations: number; responses: number };
      demo?: boolean;
    };
    return {
      reachable: true,
      latencyMs: Date.now() - started,
      windows: body.windows.length,
      window5h: body.window5h ?? null,
      demo: !!body.demo,
    };
  } catch {
    return { reachable: false };
  }
}

const whichAgy = spawnSync("which", [config.agy], { encoding: "utf8" });
const report = {
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  port: config.port,
  dataDir: config.dataDir,
  database: existsSync(dbPath)
    ? { exists: true, bytes: statSync(dbPath).size }
    : { exists: false },
  antigravity: {
    appDirPresent: existsSync(config.agyAppDir),
    cliDirPresent: existsSync(config.agyCliDir),
    agyBinary:
      whichAgy.status === 0
        ? whichAgy.stdout.trim()
        : `not found (${config.agy})`,
    brainRoots: config.brainRoots.map((r) => ({
      surface: r.surface,
      present: existsSync(r.path),
    })),
  },
  tap: tapStatus(config),
  service: await checkService(),
};

console.log(JSON.stringify(report, null, 2));
