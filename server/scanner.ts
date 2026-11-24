import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BrainRoot } from "./config.ts";
import type { ScanState } from "../shared/api.ts";
import type { Store } from "./store.ts";
import { readJsonlIncremental } from "./jsonl.ts";
import { parseTranscriptLine, parserVersion } from "./parser.ts";

/**
 * Incrementally scans local Antigravity App & CLI brain transcripts:
 *   <brainRoot>/<conversation-id>/.system_generated/logs/transcript.jsonl
 * Keeps only allowlisted metadata via `parseTranscriptLine`.
 */
export function scanTranscripts(
  roots: BrainRoot[],
  store: Store,
  hash: (v: unknown) => string,
  now = Date.now(),
): ScanState {
  const started = Date.now();
  let files = 0;
  let changed = 0;
  let bytes = 0;
  let failed = 0;

  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    let entries;
    try {
      entries = readdirSync(root.path, { withFileTypes: true });
    } catch {
      failed++;
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const transcriptPath = join(
        root.path,
        entry.name,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      if (!existsSync(transcriptPath)) continue;
      files++;
      const convHash = hash(`${root.surface}:${entry.name}`);
      const cursorKey = `transcript:${root.surface}:${convHash}`;
      try {
        const prev = store.cursor(cursorKey);
        const batch: ReturnType<typeof parseTranscriptLine>[] = [];
        const res = readJsonlIncremental(
          transcriptPath,
          prev,
          parserVersion,
          (line) => {
            const event = parseTranscriptLine(line, root.surface, convHash);
            if (event) batch.push(event);
          },
        );
        if (!res) continue;
        bytes += res.bytes;
        let inserted = 0;
        store.transaction(() => {
          for (const event of batch) {
            if (event && store.recordEvent(event)) inserted++;
          }
          if (res.skippedOversize > 0)
            store.issue(cursorKey, "oversize-line-skipped");
          store.saveCursor(cursorKey, res.cursor);
        });
        if (inserted > 0 || res.bytes > 0) changed++;
      } catch {
        failed++;
      }
    }
  }

  const scan: ScanState = {
    at: now,
    files,
    changed,
    bytes,
    elapsedMs: Date.now() - started,
    failed,
    complete: failed === 0,
  };
  store.set("scan", scan);
  return scan;
}
