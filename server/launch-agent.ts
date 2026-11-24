import { dirname, join } from "node:path";
import type { Configuration } from "./config.ts";

export const serviceLabel = "com.dicksonkam.agyscope";

const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const plistString = (s: string) => `<string>${escape(s)}</string>`;

export function launchAgent(
  root: string,
  home: string,
  node: string,
  config: Pick<
    Configuration,
    "dataDir" | "port" | "settingsPath" | "appSupport"
  >,
) {
  const string = plistString;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${string(serviceLabel)}
<key>ProgramArguments</key><array>${[node, "--import", "tsx", join(root, "server/index.ts"), "--production"].map(string).join("")}</array>
<key>WorkingDirectory</key>${string(root)}
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Standard</string><key>ExitTimeOut</key><integer>30</integer>
<key>EnvironmentVariables</key><dict>
<key>HOME</key>${string(home)}<key>PATH</key>${string([dirname(node), join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"))}
<key>PORT</key>${string(String(config.port))}<key>AGYSCOPE_DATA_DIR</key>${string(config.dataDir)}<key>AGYSCOPE_CONFIG</key>${string(config.settingsPath)}<key>AGYSCOPE_APP_SUPPORT</key>${string(config.appSupport)}
<key>AGYSCOPE_MANAGED</key><string>launchd</string>
</dict><key>StandardOutPath</key>${string(join(config.dataDir, "service/stdout.log"))}
<key>StandardErrorPath</key>${string(join(config.dataDir, "service/stderr.log"))}
</dict></plist>\n`;
}
