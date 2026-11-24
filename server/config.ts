import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Surface } from "../shared/types.ts";

export interface BrainRoot {
  surface: Surface;
  path: string;
}

export interface Configuration {
  root: string; // checkout
  appSupport: string; // ~/Library/Application Support/AGYScope
  dataDir: string; // database, identity key, backups
  settingsPath: string; // AGYScope's own settings.json
  port: number;
  agyAppDir: string; // ~/.gemini/antigravity
  agyCliDir: string; // ~/.gemini/antigravity-cli
  agyCliSettingsPath: string; // ~/.gemini/antigravity-cli/settings.json
  brainRoots: BrainRoot[]; // local Antigravity App & CLI transcript trees
  tapDir: string; // where the statusLine tap writes
  tapScript: string;
  tapLatest: string;
  tapLog: string;
  tapChain: string;
  agy: string; // Antigravity CLI executable (agy)
  cliReads: { enabled: boolean };
  demo: boolean;
}

export function configuration(
  root = resolve(import.meta.dirname, ".."),
  env = process.env,
  home = homedir(),
): Configuration {
  const appSupport = resolve(
    env.AGYSCOPE_APP_SUPPORT ??
      join(home, "Library", "Application Support", "AGYScope"),
  );
  const settingsPath = resolve(
    env.AGYSCOPE_CONFIG ?? join(appSupport, "settings.json"),
  );
  let saved: {
    dataDir?: string;
    port?: number;
    agy?: string;
    cliReads?: { enabled?: boolean };
  } = {};
  if (existsSync(settingsPath)) {
    saved = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (
      !saved ||
      typeof saved !== "object" ||
      (saved.dataDir !== undefined && typeof saved.dataDir !== "string")
    )
      throw Error(
        "Invalid AGYScope settings. Restore a valid settings.json or use AGYSCOPE_CONFIG.",
      );
  }
  const port = Number(env.PORT ?? saved.port ?? 4337);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("PORT must be an integer between 1024 and 65535.");

  const agyAppDir = resolve(
    env.AGYSCOPE_APP_DIR ?? join(home, ".gemini", "antigravity"),
  );
  const agyCliDir = resolve(
    env.AGYSCOPE_CLI_DIR ?? join(home, ".gemini", "antigravity-cli"),
  );
  const brainRoots: BrainRoot[] = env.AGYSCOPE_BRAIN_ROOTS
    ? env.AGYSCOPE_BRAIN_ROOTS.split(":")
        .filter(Boolean)
        .map((p, i) => ({
          surface: i === 0 ? "app" : "cli",
          path: resolve(p),
        }))
    : [
        { surface: "app", path: join(agyAppDir, "brain") },
        { surface: "cli", path: join(agyCliDir, "brain") },
      ];

  const tapDir = join(appSupport, "tap");
  return {
    root,
    appSupport,
    settingsPath,
    port,
    dataDir: resolve(
      env.AGYSCOPE_DATA_DIR ?? saved.dataDir ?? join(appSupport, "data"),
    ),
    agyAppDir,
    agyCliDir,
    agyCliSettingsPath: join(agyCliDir, "settings.json"),
    brainRoots,
    tapDir,
    tapScript: join(tapDir, "agyscope-statusline.py"),
    tapLatest: join(tapDir, "latest.json"),
    tapLog: join(tapDir, "statusline.jsonl"),
    tapChain: join(tapDir, "chain.json"),
    agy: env.AGYSCOPE_AGY ?? saved.agy ?? "agy",
    cliReads: {
      enabled: env.AGYSCOPE_CLI_READS
        ? env.AGYSCOPE_CLI_READS !== "0"
        : (saved.cliReads?.enabled ?? true),
    },
    demo: env.AGYSCOPE_DEMO === "1",
  };
}

/**
 * Hashed pseudonymous installation identity from Antigravity's local installation_id + settings.
 * Never reads credentials or OAuth tokens.
 */
export function accountIdentity(
  config: Pick<Configuration, "agyAppDir" | "agyCliDir" | "agyCliSettingsPath">,
  hash: (v: unknown) => string,
): { account: string; useG1Credits: boolean | null } {
  let account = "unattributed-local";
  for (const dir of [config.agyAppDir, config.agyCliDir]) {
    try {
      const idFile = join(dir, "installation_id");
      if (existsSync(idFile)) {
        const raw = readFileSync(idFile, "utf8").trim();
        if (raw.length > 0 && raw.length <= 128) {
          account = hash(raw);
          break;
        }
      }
    } catch {
      /* Missing or unreadable installation_id stays unattributed. */
    }
  }
  let useG1Credits: boolean | null = null;
  try {
    if (existsSync(config.agyCliSettingsPath)) {
      const parsed = JSON.parse(readFileSync(config.agyCliSettingsPath, "utf8"));
      if (typeof parsed?.useG1Credits === "boolean")
        useG1Credits = parsed.useG1Credits;
    }
  } catch {
    /* Optional CLI settings file. */
  }
  return { account, useG1Credits };
}
