import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ActivityEvent,
  Attempt,
  FileCursor,
  Observation,
  Surface,
} from "../shared/types.ts";
import type {
  ModelBreakdown,
  RecentConversation,
  SurfaceBreakdown,
  ToolCount,
  WorkBucket,
} from "../shared/api.ts";

/** Unchanged quota readings are written to history at most every ten minutes. */
export const historyHeartbeatMs = 600_000;

export function emptyWorkBucket(): WorkBucket {
  return {
    conversations: 0,
    responses: 0,
    subagents: 0,
    swarms: 0,
    browserRuns: 0,
    scheduledTasks: 0,
    artifacts: 0,
    input: 0,
    cacheRead: 0,
    output: 0,
    lastAt: null,
  };
}

export class Store {
  db: DatabaseSync;
  private routine = new Map<string, Attempt>();

  constructor(
    public path: string,
    readOnly = false,
  ) {
    if (readOnly) {
      this.db = new DatabaseSync(path, { readOnly: true });
      this.db.exec("PRAGMA busy_timeout=5000");
      return;
    }
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS observations (key TEXT PRIMARY KEY, at INTEGER, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS latest (
        account TEXT NOT NULL,
        bucket TEXT NOT NULL,
        slot TEXT NOT NULL,
        at INTEGER NOT NULL,
        data TEXT NOT NULL,
        history_at INTEGER NOT NULL,
        PRIMARY KEY (account, bucket, slot)
      );
      CREATE TABLE IF NOT EXISTS events (
        key TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        surface TEXT NOT NULL,
        conversation TEXT NOT NULL,
        model TEXT NOT NULL,
        input INTEGER NOT NULL,
        cache_read INTEGER NOT NULL,
        output INTEGER NOT NULL,
        subagents INTEGER NOT NULL,
        swarms INTEGER NOT NULL,
        browser_runs INTEGER NOT NULL,
        schedules INTEGER NOT NULL,
        artifacts INTEGER NOT NULL,
        tools TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS issues (key TEXT PRIMARY KEY, code TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS observation_at ON observations(at);
      CREATE INDEX IF NOT EXISTS observation_scope_at ON observations(
        json_extract(data,'$.account'),
        json_extract(data,'$.bucket'),
        json_extract(data,'$.slot'),
        json_extract(data,'$.source'),
        at,
        key
      );
      CREATE INDEX IF NOT EXISTS events_at ON events(at);
      CREATE INDEX IF NOT EXISTS events_conv ON events(conversation, at);
      CREATE INDEX IF NOT EXISTS events_model ON events(model);`);

    const v = this.db
      .prepare("SELECT value FROM meta WHERE key=?")
      .get("schema") as { value: string } | undefined;
    if (v && v.value !== "1")
      throw new Error(
        "Unsupported AGYScope database schema. Preserve this file and use a compatible version.",
      );
    this.db
      .prepare("INSERT OR IGNORE INTO meta VALUES (?,?)")
      .run("schema", "1");

    const emptyLatest = !this.db.prepare("SELECT 1 FROM latest LIMIT 1").get();
    if (
      emptyLatest &&
      this.db.prepare("SELECT 1 FROM observations LIMIT 1").get()
    ) {
      this.db
        .exec(`INSERT INTO latest (account, bucket, slot, at, data, history_at)
        SELECT json_extract(data,'$.account'), json_extract(data,'$.bucket'), json_extract(data,'$.slot'), at, data, at
        FROM observations WHERE true ORDER BY at, key
        ON CONFLICT (account, bucket, slot) DO UPDATE SET at = excluded.at, data = excluded.data, history_at = excluded.history_at
        WHERE excluded.at >= latest.at;`);
    }
  }

  get<T>(key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key=?")
      .get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }

  set(key: string, value: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO meta VALUES (?,?)")
      .run(key, JSON.stringify(value));
  }

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Records a quota observation. Keeps `latest` constant-time for the menu bar while
   * storing history rows only on changes plus a 10-minute heartbeat.
   */
  observe(o: Observation): boolean {
    const key = (x: Observation) =>
      JSON.stringify([
        x.account,
        x.bucket,
        x.slot,
        x.source,
        x.at,
        x.used,
        x.reset,
      ]);
    const insert = (x: Observation, data: string) =>
      this.db
        .prepare("INSERT OR IGNORE INTO observations VALUES (?,?,?)")
        .run(key(x), x.at, data).changes > 0;
    const data = JSON.stringify(o);
    const row = this.db
      .prepare(
        "SELECT at, data, history_at FROM latest WHERE account=? AND bucket=? AND slot=?",
      )
      .get(o.account, o.bucket, o.slot) as
      | { at: number; data: string; history_at: number }
      | undefined;

    if (row && o.at < row.at) return insert(o, data);
    const previous: Observation | null = row ? JSON.parse(row.data) : null;
    if (previous && o.at === row!.at && key(previous) === key(o)) return false;

    const changed =
      !previous ||
      previous.used !== o.used ||
      previous.reset !== o.reset ||
      previous.source !== o.source ||
      previous.creditsActive !== o.creditsActive;

    let historyAt = row?.history_at ?? o.at;
    if (changed || !row || o.at - row.history_at >= historyHeartbeatMs) {
      if (changed && previous && row!.at > row!.history_at)
        insert(previous, row!.data);
      insert(o, data);
      historyAt = o.at;
    }
    this.db
      .prepare(
        `INSERT INTO latest (account, bucket, slot, at, data, history_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT (account, bucket, slot) DO UPDATE SET at = excluded.at, data = excluded.data, history_at = excluded.history_at`,
      )
      .run(o.account, o.bucket, o.slot, o.at, data, historyAt);
    return true;
  }

  /** Records an allowlisted Antigravity planner step, idempotently by key. */
  recordEvent(e: ActivityEvent): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO events
         (key, at, surface, conversation, model, input, cache_read, output, subagents, swarms, browser_runs, schedules, artifacts, tools, data)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.key,
        e.at,
        e.surface,
        e.conversation,
        e.model,
        e.input,
        e.cacheRead,
        e.output,
        e.subagentCalls,
        e.swarmCalls,
        e.browserCalls,
        e.scheduleCalls,
        e.artifactWrites,
        JSON.stringify(e.tools),
        JSON.stringify(e),
      );
    return Number(res.changes) > 0;
  }

  cursor(key: string): FileCursor | undefined {
    const row = this.db
      .prepare("SELECT data FROM files WHERE key=?")
      .get(key) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  saveCursor(key: string, data: FileCursor) {
    this.db
      .prepare("INSERT OR REPLACE INTO files VALUES (?,?)")
      .run(key, JSON.stringify(data));
  }

  issue(key: string, code: string) {
    this.db.prepare("INSERT OR IGNORE INTO issues VALUES (?,?)").run(key, code);
  }

  issues(): { code: string; count: number }[] {
    return (
      this.db
        .prepare(
          "SELECT code, count(*) AS count FROM issues GROUP BY code ORDER BY count DESC",
        )
        .all() as { code: string; count: number }[]
    ).map((r) => ({ code: r.code, count: r.count }));
  }

  observations(): Observation[] {
    return (
      this.db
        .prepare("SELECT data FROM observations ORDER BY at, key")
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }

  latest(): Observation[] {
    const rows = this.db
      .prepare("SELECT data FROM latest ORDER BY account, bucket, slot")
      .all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data));
  }

  workSummary(sinceMs?: number): WorkBucket {
    const where = sinceMs !== undefined ? "WHERE at >= ?" : "";
    const sql = `SELECT
      count(DISTINCT conversation) AS conversations,
      count(*) AS responses,
      coalesce(sum(subagents), 0) AS subagents,
      coalesce(sum(swarms), 0) AS swarms,
      coalesce(sum(browser_runs), 0) AS browserRuns,
      coalesce(sum(schedules), 0) AS scheduledTasks,
      coalesce(sum(artifacts), 0) AS artifacts,
      coalesce(sum(input), 0) AS input,
      coalesce(sum(cache_read), 0) AS cacheRead,
      coalesce(sum(output), 0) AS output,
      max(at) AS lastAt
      FROM events ${where}`;
    const stmt = this.db.prepare(sql);
    const row = (
      sinceMs !== undefined ? stmt.get(sinceMs) : stmt.get()
    ) as WorkBucket | undefined;
    if (!row) return emptyWorkBucket();
    return {
      conversations: Number(row.conversations ?? 0),
      responses: Number(row.responses ?? 0),
      subagents: Number(row.subagents ?? 0),
      swarms: Number(row.swarms ?? 0),
      browserRuns: Number(row.browserRuns ?? 0),
      scheduledTasks: Number(row.scheduledTasks ?? 0),
      artifacts: Number(row.artifacts ?? 0),
      input: Number(row.input ?? 0),
      cacheRead: Number(row.cacheRead ?? 0),
      output: Number(row.output ?? 0),
      lastAt: row.lastAt !== null && row.lastAt !== undefined ? Number(row.lastAt) : null,
    };
  }

  modelBreakdown(sinceMs?: number): ModelBreakdown[] {
    const where = sinceMs !== undefined ? "WHERE at >= ?" : "";
    const stmt = this.db.prepare(`SELECT
      model,
      count(*) AS responses,
      coalesce(sum(input), 0) AS input,
      coalesce(sum(cache_read), 0) AS cacheRead,
      coalesce(sum(output), 0) AS output,
      max(at) AS lastAt
      FROM events ${where}
      GROUP BY model
      ORDER BY responses DESC, output DESC
      LIMIT 12`);
    const rows = (
      sinceMs !== undefined ? stmt.all(sinceMs) : stmt.all()
    ) as unknown as ModelBreakdown[];
    return rows.map((r) => ({
      model: r.model,
      responses: Number(r.responses),
      input: Number(r.input),
      cacheRead: Number(r.cacheRead),
      output: Number(r.output),
      lastAt: Number(r.lastAt),
    }));
  }

  surfaceBreakdown(sinceMs?: number): SurfaceBreakdown[] {
    const where = sinceMs !== undefined ? "WHERE at >= ?" : "";
    const stmt = this.db.prepare(`SELECT
      surface,
      count(DISTINCT conversation) AS conversations,
      count(*) AS responses,
      coalesce(sum(output), 0) AS output
      FROM events ${where}
      GROUP BY surface
      ORDER BY responses DESC`);
    const rows = (
      sinceMs !== undefined ? stmt.all(sinceMs) : stmt.all()
    ) as unknown as SurfaceBreakdown[];
    return rows.map((r) => ({
      surface: r.surface as Surface,
      conversations: Number(r.conversations),
      responses: Number(r.responses),
      output: Number(r.output),
    }));
  }

  topTools(sinceMs?: number, limit = 12): ToolCount[] {
    const where = sinceMs !== undefined ? "WHERE at >= ?" : "";
    const stmt = this.db.prepare(
      `SELECT tools FROM events ${where} ORDER BY at DESC LIMIT 4000`,
    );
    const rows = (
      sinceMs !== undefined ? stmt.all(sinceMs) : stmt.all()
    ) as { tools: string }[];
    const counts = new Map<string, number>();
    for (const row of rows) {
      try {
        const list = JSON.parse(row.tools) as string[];
        for (const name of list) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      } catch {
        /* Skip malformed tool arrays. */
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  recentConversations(limit = 8): RecentConversation[] {
    const rows = this.db
      .prepare(
        `SELECT
          conversation AS id,
          surface,
          max(at) AS lastAt,
          count(*) AS responses,
          coalesce(sum(subagents), 0) AS subagents,
          coalesce(sum(swarms), 0) AS swarms,
          coalesce(sum(browser_runs), 0) AS browserRuns,
          coalesce(sum(artifacts), 0) AS artifacts,
          (SELECT model FROM events e2 WHERE e2.conversation = events.conversation GROUP BY model ORDER BY count(*) DESC LIMIT 1) AS topModel
        FROM events
        GROUP BY conversation, surface
        ORDER BY lastAt DESC
        LIMIT ?`,
      )
      .all(limit) as unknown as RecentConversation[];
    return rows.map((r) => ({
      id: r.id.slice(0, 8),
      surface: r.surface as Surface,
      lastAt: Number(r.lastAt),
      responses: Number(r.responses),
      subagents: Number(r.subagents),
      swarms: Number(r.swarms),
      browserRuns: Number(r.browserRuns),
      artifacts: Number(r.artifacts),
      topModel: r.topModel ?? "unknown",
    }));
  }

  attempt(a: Attempt) {
    const kind = a.message.split(":")[0];
    const last = this.routine.get(kind);
    if (
      a.ok &&
      last &&
      last.ok &&
      last.message === a.message &&
      a.at - last.at < 600_000
    )
      return;
    this.routine.set(kind, a);
    this.db
      .prepare("INSERT INTO attempts(data) VALUES (?)")
      .run(JSON.stringify(a));
  }

  attempts(): Attempt[] {
    return (
      this.db
        .prepare("SELECT data FROM attempts ORDER BY id DESC LIMIT 20")
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }

  backup(path: string) {
    this.db.prepare("VACUUM INTO ?").run(path);
  }

  close() {
    this.db.close();
  }
}
