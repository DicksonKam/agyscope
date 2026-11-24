import { join } from "node:path";
import { configuration } from "./config.ts";
import { collectOnce } from "./collect.ts";
import { identityFactory } from "./privacy.ts";
import { Store } from "./store.ts";
import { sortWindows, windowLabel } from "../shared/allowance.ts";

const config = configuration();
const hash = identityFactory(config.dataDir);
const store = new Store(join(config.dataDir, "agyscope.sqlite"));
const result = await collectOnce(config, store, hash);
const windows = sortWindows(store.latest());
const summary = store.workSummary();
const window5h = store.workSummary(Date.now() - 5 * 3600_000);

console.log(
  JSON.stringify(
    {
      collect: result,
      windows: windows.map((w) => ({
        label: windowLabel(w),
        remainingPercent: Math.round((100 - w.used) * 10) / 10,
        reset: w.reset ? new Date(w.reset * 1000).toISOString() : null,
        source: w.source,
      })),
      window5h,
      totals: summary,
      topModels: store.modelBreakdown().slice(0, 5),
      topTools: store.topTools(undefined, 8),
    },
    null,
    2,
  ),
);
store.close();
