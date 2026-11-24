import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Per-installation HMAC so identifiers in the database and exports are pseudonymous. */
export function identityFactory(dir: string) {
  const file = join(dir, "identity.key");
  if (!existsSync(file) && existsSync(join(dir, "agyscope.sqlite")))
    throw new Error(
      "The identifier salt is missing. Preserve this data directory and restore its matching identity.key from backup.",
    );
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  }
  const salt = readFileSync(file);
  return (value: unknown) =>
    createHmac("sha256", salt)
      .update(String(value ?? "unknown"))
      .digest("hex")
      .slice(0, 20);
}

export const numeric = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export const integer = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** Machine identifiers (models, tool names, plan tiers), never conversation prose. */
export const label = (v: unknown) =>
  typeof v === "string" && /^[\w.:\-\/ ()\[\]]{1,80}$/.test(v)
    ? v.trim()
    : "unknown";

export const safeKey = (v: unknown) =>
  typeof v === "string"
    ? v
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 48)
    : "";
