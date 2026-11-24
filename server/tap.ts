import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { configuration, type Configuration } from "./config.ts";

export interface TapInstallStatus {
  installed: boolean;
  scriptPresent: boolean;
  settingsPath: string;
  chainedCommand: string | null;
}

export function status(config: Configuration): TapInstallStatus {
  const scriptPresent = existsSync(config.tapScript);
  let installed = false;
  let chainedCommand: string | null = null;
  if (existsSync(config.agyCliSettingsPath)) {
    try {
      const settings = JSON.parse(
        readFileSync(config.agyCliSettingsPath, "utf8"),
      );
      const cmd = settings?.statusLine?.command;
      if (typeof cmd === "string" && cmd.includes(config.tapScript))
        installed = true;
    } catch {
      /* Unreadable settings treat tap as not installed. */
    }
  }
  if (existsSync(config.tapChain)) {
    try {
      const chain = JSON.parse(readFileSync(config.tapChain, "utf8"));
      if (typeof chain?.command === "string" && chain.command.trim())
        chainedCommand = chain.command;
    } catch {
      /* Ignore malformed chain metadata. */
    }
  }
  return {
    installed,
    scriptPresent,
    settingsPath: config.agyCliSettingsPath,
    chainedCommand,
  };
}

export function installTap(config: Configuration) {
  mkdirSync(config.tapDir, { recursive: true, mode: 0o700 });
  const sourceScript = join(config.root, "scripts", "agyscope-statusline.py");
  copyFileSync(sourceScript, config.tapScript);
  chmodSync(config.tapScript, 0o755);

  mkdirSync(dirname(config.agyCliSettingsPath), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(config.agyCliSettingsPath)) {
    const raw = readFileSync(config.agyCliSettingsPath, "utf8");
    const stamp = new Date().toISOString().replaceAll(":", "-");
    writeFileSync(
      join(config.tapDir, `settings-backup-${stamp}.json`),
      raw,
      { mode: 0o600 },
    );
    settings = JSON.parse(raw);
  }

  const prevStatus = settings.statusLine as
    | { command?: unknown; type?: unknown; enabled?: unknown }
    | undefined;
  const prevCommand =
    typeof prevStatus?.command === "string" &&
    !prevStatus.command.includes(config.tapScript)
      ? prevStatus.command
      : null;

  if (prevCommand) {
    writeFileSync(
      config.tapChain,
      JSON.stringify({ command: prevCommand }, null, 2),
      { mode: 0o600 },
    );
  }

  settings.statusLine = {
    type: "command",
    command: `python3 "${config.tapScript}"`,
    enabled: true,
  };
  writeFileSync(
    config.agyCliSettingsPath,
    JSON.stringify(settings, null, 2) + "\n",
    { mode: 0o600 },
  );
  return status(config);
}

export function uninstallTap(config: Configuration) {
  let prevCommand: string | null = null;
  if (existsSync(config.tapChain)) {
    try {
      const chain = JSON.parse(readFileSync(config.tapChain, "utf8"));
      if (typeof chain?.command === "string" && chain.command.trim())
        prevCommand = chain.command;
    } catch {
      /* Ignore unreadable chain file. */
    }
    unlinkSync(config.tapChain);
  }

  if (existsSync(config.agyCliSettingsPath)) {
    const settings = JSON.parse(
      readFileSync(config.agyCliSettingsPath, "utf8"),
    ) as Record<string, unknown>;
    const current = settings.statusLine as { command?: unknown } | undefined;
    if (
      typeof current?.command === "string" &&
      current.command.includes(config.tapScript)
    ) {
      if (prevCommand) {
        settings.statusLine = {
          type: "command",
          command: prevCommand,
          enabled: true,
        };
      } else {
        delete settings.statusLine;
      }
      writeFileSync(
        config.agyCliSettingsPath,
        JSON.stringify(settings, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
  }
  return status(config);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = configuration();
  const cmd = process.argv[2] ?? "status";
  if (cmd === "install") {
    console.log(JSON.stringify(installTap(config), null, 2));
  } else if (cmd === "uninstall") {
    console.log(JSON.stringify(uninstallTap(config), null, 2));
  } else if (cmd === "status") {
    console.log(JSON.stringify(status(config), null, 2));
  } else {
    throw Error("Usage: npm run tap -- install|status|uninstall");
  }
}
