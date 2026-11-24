import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Store } from "./store.ts";
import { identityFactory } from "./privacy.ts";
import { accountIdentity, configuration } from "./config.ts";
import { Collector } from "./collector.ts";
import { collectOnce } from "./collect.ts";
import { dashboardQuery } from "./dashboard.ts";
import { DashboardReader } from "./dashboard-reader.ts";
import { status as tapStatus } from "./tap.ts";
import { CliUsageReader, cliCommand } from "./usage-reader.ts";
import { sortWindows } from "../shared/allowance.ts";
import type { DashboardStatus, ScanState } from "../shared/api.ts";

const config = configuration();
const { port, root, dataDir: dir } = config;
mkdirSync(dir, { recursive: true, mode: 0o700 });
const hash = identityFactory(dir);
const store = new Store(join(dir, "agyscope.sqlite"));
chmodSync(store.path, 0o600);
const csrf = randomBytes(32).toString("hex");
const dashboard = new DashboardReader(store.path);

let lastTapLines = 0;
let firstCycle = true;

const latestReadingAt = () => {
  const windows = store.latest();
  return windows.length ? Math.max(...windows.map((w) => w.at)) : null;
};

const identity = () => accountIdentity(config, hash);

const cliReader = new CliUsageReader(
  store,
  cliCommand(config.agy, config.appSupport),
  config.agy,
  () => identity().account,
  () =>
    !config.demo &&
    (store.get<boolean>("cliReadsEnabled") ?? config.cliReads.enabled),
);

async function collect(): Promise<boolean> {
  if (config.demo) return true;
  const result = await collectOnce(config, store, hash);
  lastTapLines = result.tap?.lines ?? 0;
  await cliReader.read();
  const now = Date.now();
  if (!firstCycle && (result.transcripts?.changed ?? 0) > 0)
    store.set("lastActivityAt", now);
  firstCycle = false;
  return result.error === null;
}

const enabled = store.get<boolean>("collectionEnabled") ?? true;
const collector = new Collector(
  collect,
  enabled,
  (state) => {
    store.set("collectionEnabled", state.enabled);
    store.set("collectorState", state);
  },
  60_000,
  store.get("collectorState"),
);

function statusSnapshot(): DashboardStatus {
  const now = Date.now();
  const windows = sortWindows(store.latest());
  let installed = false;
  try {
    installed = tapStatus(config).installed;
  } catch {
    /* Unreadable CLI settings treat tap as not installed. */
  }
  const id = identity();
  const planTier = windows.find((w) => w.planTier)?.planTier ?? null;
  const creditsActive = windows.some((w) => w.creditsActive);
  const window5h = store.workSummary(now - 5 * 3600_000);
  const latestAt = windows.length
    ? Math.max(...windows.map((w) => w.at))
    : null;
  const lastActivity = Math.max(
    store.get<number>("lastActivityAt") ?? 0,
    window5h.lastAt ?? 0,
  );

  return {
    version: 1,
    csrf,
    now,
    demo: config.demo || windows.some((w) => w.source === "demo"),
    collector: {
      ...collector.state,
      managed: process.env.AGYSCOPE_MANAGED === "launchd",
    },
    tap: {
      installed,
      present: existsSync(config.tapLog),
      latestAt,
      lines: lastTapLines,
    },
    scan: store.get<ScanState>("scan") ?? null,
    account: {
      account: id.account,
      planTier,
      useG1Credits: id.useG1Credits,
      creditsActive,
      cli: cliReader.state(now),
    },
    activity: {
      lastAt: lastActivity > 0 ? lastActivity : null,
      sinceReading: latestAt !== null && lastActivity > latestAt,
    },
    window5h,
    attempts: store.attempts(),
    windows,
  };
}

function json(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > 16_000) throw new Error("Request too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

const production = process.argv.includes("--production");
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      root,
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });

const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  const expectedHost = `127.0.0.1:${port}`;
  if (
    req.headers.host !== expectedHost &&
    req.headers.host !== `localhost:${port}`
  )
    return json(res, 403, { error: "Loopback host required" });

  const origin = req.headers.origin;
  if (
    origin &&
    ![`http://${expectedHost}`, `http://localhost:${port}`].includes(origin)
  )
    return json(res, 403, { error: "Origin rejected" });

  const url = new URL(req.url ?? "/", `http://${expectedHost}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST") {
        const token = req.headers["x-agyscope-token"];
        if (
          !origin ||
          req.headers["content-type"] !== "application/json" ||
          typeof token !== "string" ||
          token.length !== csrf.length ||
          !timingSafeEqual(Buffer.from(token), Buffer.from(csrf))
        )
          return json(res, 403, {
            error: "Same-origin request token required",
          });
      }
      if (req.method === "GET" && url.pathname === "/api/status")
        return json(res, 200, statusSnapshot());
      if (req.method === "GET" && url.pathname === "/api/state") {
        const query = dashboardQuery(url.searchParams);
        try {
          return json(res, 200, {
            ...statusSnapshot(),
            ...(await dashboard.read(query)),
          });
        } catch (e) {
          return json(res, 503, { error: (e as Error).message });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/collector") {
        const b = await body(req);
        if (typeof b?.enabled !== "boolean")
          return json(res, 400, {
            error: "Choose whether background monitoring is enabled.",
          });
        collector.setEnabled(b.enabled);
        return json(res, 200, statusSnapshot());
      }
      if (req.method === "POST" && url.pathname === "/api/refresh") {
        await collector.cycle(true);
        return json(res, 200, statusSnapshot());
      }
      if (req.method === "POST" && url.pathname === "/api/cli-reads") {
        const b = await body(req);
        if (typeof b?.enabled !== "boolean")
          return json(res, 400, {
            error: "Choose whether Antigravity CLI reads run.",
          });
        store.set("cliReadsEnabled", b.enabled);
        return json(res, 200, statusSnapshot());
      }
      return json(res, 404, { error: "Unknown operation" });
    }

    if (req.method !== "GET")
      return json(res, 405, { error: "Method not allowed" });
    if (vite)
      return vite.middlewares(req, res, () =>
        json(res, 404, { error: "Not found" }),
      );

    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    const file = url.pathname.startsWith("/assets/")
      ? resolve(root, "dist", "." + url.pathname)
      : join(root, "dist/index.html");
    if (!file.startsWith(join(root, "dist") + "/") || !existsSync(file))
      return json(res, 404, {
        error: "Build assets unavailable; run npm run build.",
      });
    res.setHeader(
      "Content-Type",
      (
        {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        } as Record<string, string>
      )[extname(file)] ?? "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch {
    if (!res.headersSent)
      json(res, 400, {
        error:
          "The operation could not be completed. Previous observations are preserved.",
      });
    else res.end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AGYScope ready at http://127.0.0.1:${port}`);
  void collector.cycle();
});

server.on("error", () => {
  console.error(
    "AGYScope could not bind its loopback port. Stop the other instance or choose a different PORT.",
  );
  store.close();
  process.exitCode = 1;
  void vite?.close();
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await dashboard.stop();
  await collector.stop();
  await vite?.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
