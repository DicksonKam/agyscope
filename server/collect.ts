import { accountIdentity, type Configuration } from "./config.ts";
import { identityFactory } from "./privacy.ts";
import { scanTranscripts } from "./scanner.ts";
import { importTapLog } from "./statusline.ts";
import type { Store } from "./store.ts";
import type { ScanState } from "../shared/api.ts";

export interface CollectResult {
  tap: { lines: number; observations: number } | null;
  transcripts: ScanState | null;
  error: string | null;
}

export async function collectOnce(
  config: Configuration,
  store: Store,
  hash = identityFactory(config.dataDir),
  now = Date.now(),
): Promise<CollectResult> {
  try {
    const id = accountIdentity(config, hash);
    const tap = importTapLog(config.tapLog, id.account, store, hash, now);
    const transcripts = scanTranscripts(config.brainRoots, store, hash, now);
    return { tap, transcripts, error: null };
  } catch (e) {
    return {
      tap: null,
      transcripts: null,
      error: (e as Error).message,
    };
  }
}
