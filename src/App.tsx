import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  Gauge,
  LoaderCircle,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type { DashboardState } from "../shared/api";
import { selectPrimaryPair, windowKey } from "../shared/allowance";
import { liveMs } from "../shared/history";
import { AgyMark } from "./AgyMark";
import { AgentsWork } from "./AgentsWork";
import { ModelsTools } from "./ModelsTools";
import { QuotaRunway } from "./QuotaRunway";
import { mergeDashboardStatus, requestDashboard } from "./dashboard-request";
import { DashboardRequests, performAction } from "./request";
import { elapsed, timezonePreference, validTimezone } from "./time";

type Tab = "runway" | "work" | "models";
const defaultWindow = JSON.stringify(["antigravity", "five_hour"]);

export function App() {
  const [tab, setTab] = useState<Tab>("runway");
  const [timezone, setTimezone] = useState(timezonePreference);
  const [selectedWindow, setSelectedWindow] = useState(defaultWindow);
  const [range, setRange] = useState("30");
  const [data, setData] = useState<DashboardState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unreachable, setUnreachable] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [dark, setDark] = useState(
    () => (localStorage.getItem("agy-theme") ?? "dark") === "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("agy-theme", dark ? "dark" : "light");
  }, [dark]);

  const requests = useRef(new DashboardRequests());

  async function load() {
    const params = new URLSearchParams({
      days: range === "current" ? "30" : range,
      historyScope: range === "current" ? "current" : "range",
      window: selectedWindow,
      timezone,
    });
    const seq = requests.current.beginRead(params.toString());
    if (seq === null) return;
    try {
      const result = await requestDashboard(params.toString());
      if (requests.current.isCurrent(seq)) {
        setData((prev) =>
          result.partial
            ? mergeDashboardStatus(prev, result.data)
            : result.data,
        );
        setError(
          result.partial
            ? "Dashboard details are delayed. Live status is still available."
            : "",
        );
        setUnreachable(false);
      }
    } catch {
      if (requests.current.isCurrent(seq)) {
        setUnreachable(true);
        setError(
          "Cannot reach the local AGYScope service. Showing last loaded data.",
        );
      }
    } finally {
      requests.current.endRead(seq);
    }
  }

  const loadRef = useRef(load);
  loadRef.current = load;

  async function action(path: string, payload: unknown = {}) {
    if (!data || !requests.current.beginAction()) return;
    setBusy(path);
    setError("");
    setNotice("");
    try {
      const result = await performAction(path, payload, data.csrf);
      setUnreachable(false);
      if (result.version !== undefined)
        setData((prev) => mergeDashboardStatus(prev, result));
      if (result.message) setNotice(result.message);
    } catch (e) {
      if (e instanceof TypeError) setUnreachable(true);
      setError(
        e instanceof TypeError
          ? "Cannot reach the local service. Previous readings are preserved."
          : (e as Error).message,
      );
    } finally {
      requests.current.endAction();
      setBusy("");
      void loadRef.current();
    }
  }

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      if (!document.hidden) void loadRef.current();
    }, 15_000);
    const resume = () => {
      if (!document.hidden) void loadRef.current();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, []);

  useEffect(() => {
    void loadRef.current();
  }, [range, selectedWindow, timezone]);

  const { fiveHour } = selectPrimaryPair(data?.windows ?? []);
  const latest =
    data?.windows.find((w) => windowKey(w) === selectedWindow) ??
    fiveHour ??
    data?.windows[0];
  const live = !!latest && !unreachable && now - latest.at <= liveMs;
  const activitySince = !!data?.activity?.sinceReading && !live;

  const pageMeta: Record<Tab, { crumb: string; eyebrow: string; title: string; subtitle: string }> = {
    runway: {
      crumb: "Quota & Runway",
      eyebrow: "YOUR ANTIGRAVITY ALLOWANCE, IN PERSPECTIVE",
      title: "Clear runway ahead.",
      subtitle:
        "5-hour rolling refills underneath your weekly ceiling, AI Credits fallback, and recorded history.",
    },
    work: {
      crumb: "Agents & Work",
      eyebrow: "COMPUTATIONAL WORK FOOTPRINT",
      title: "What moved your meter.",
      subtitle:
        "Conversations, subagents, swarms, browser runs, and token counts scanned locally from Antigravity.",
    },
    models: {
      crumb: "Models & Tools",
      eyebrow: "MODEL POOLS & SURFACES",
      title: "Pools, models, and tools.",
      subtitle:
        "Model-level quota pools, Antigravity App vs. CLI surfaces, and most-invoked agent capabilities.",
    },
  };
  const meta = pageMeta[tab];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("runway");
          }}
        >
          <span className="brand-symbol">
            <AgyMark size={20} />
          </span>
          <span>
            AGYScope
            <span className="brand-caption">ANTIGRAVITY OBSERVATORY</span>
          </span>
        </a>

        <div className="workspace-box">
          <span className="avatar">
            <AgyMark size={15} />
          </span>
          <div>
            Your workspace
            <small>
              {data?.demo
                ? "Synthetic demo mode"
                : data?.account.planTier
                  ? `Antigravity · ${data.account.planTier}`
                  : "Local Antigravity monitor"}
            </small>
          </div>
        </div>

        <div className="nav-label">OBSERVATORY</div>
        <nav aria-label="Main navigation">
          <button
            aria-current={tab === "runway" ? "page" : undefined}
            className={tab === "runway" ? "selected" : ""}
            onClick={() => setTab("runway")}
          >
            <Gauge size={17} />
            Quota &amp; Runway
          </button>
          <button
            aria-current={tab === "work" ? "page" : undefined}
            className={tab === "work" ? "selected" : ""}
            onClick={() => setTab("work")}
          >
            <Activity size={17} />
            Agents &amp; Work
          </button>
          <button
            aria-current={tab === "models" ? "page" : undefined}
            className={tab === "models" ? "selected" : ""}
            onClick={() => setTab("models")}
          >
            <Cpu size={17} />
            Models &amp; Tools
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="private-box">
            <ShieldCheck size={18} />
            <div>
              Private by design
              <small>
                Zero credentials read. Metadata stays strictly on this Mac.
              </small>
            </div>
          </div>
          <button className="theme-control" onClick={() => setDark(!dark)}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            {dark ? "Light appearance" : "Dark appearance"}
          </button>
          <div className="version">
            AGYSCOPE <span>v0.1.0</span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Observatory <span>/</span> <strong>{meta.crumb}</strong>
          </div>
          <div className="topbar-right">
            <div className="mobile-nav">
              <button
                className={tab === "runway" ? "selected" : ""}
                onClick={() => setTab("runway")}
              >
                Runway
              </button>
              <button
                className={tab === "work" ? "selected" : ""}
                onClick={() => setTab("work")}
              >
                Work
              </button>
              <button
                className={tab === "models" ? "selected" : ""}
                onClick={() => setTab("models")}
              >
                Models
              </button>
            </div>
            <span className="local-label">
              <span className="status-dot" /> Local on this Mac
            </span>
            <button
              className="mobile-theme"
              aria-label={
                dark
                  ? "Switch to light appearance"
                  : "Switch to dark appearance"
              }
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <main>
          <div className="page-heading">
            <div className="eyebrow">{meta.eyebrow}</div>
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>

          <div className="freshness">
            <span className={live ? "status-dot" : "status-dot muted-dot"} />
            <span>
              {latest
                ? `${live ? "Live" : "Last"} reading · ${elapsed(latest.at, now)}${activitySince ? " · local activity since" : ""}`
                : data
                  ? `${data.window5h.conversations} conversations in last 5h`
                  : "Connecting to local service…"}
            </span>
            <span className="divider" />
            <label>
              <input
                type="checkbox"
                checked={data?.collector.enabled ?? false}
                disabled={!data || !!busy || data.demo}
                onChange={(e) =>
                  void action("collector", { enabled: e.target.checked })
                }
              />
              {data?.collector.enabled
                ? "Background monitoring on"
                : "Background monitoring paused"}
            </label>
            <span className="divider" />
            <label>
              <input
                type="checkbox"
                checked={data?.account.cli.enabled ?? false}
                disabled={!data || !!busy || data.demo}
                onChange={(e) =>
                  void action("cli-reads", { enabled: e.target.checked })
                }
              />
              {data?.account.cli.enabled
                ? "CLI quota checks on"
                : "CLI quota checks off"}
            </label>
          </div>

          <div aria-live="polite">
            {error && (
              <div className="banner error" role="alert">
                {error}
              </div>
            )}
            {notice && <div className="banner">{notice}</div>}
          </div>

          {!data ? (
            unreachable ? (
              <section className="card">
                <h2>Start the local AGYScope service</h2>
                <p className="subtle-note">
                  Run <code>npm start</code> (or <code>npm run demo</code> for
                  synthetic preview data), or install the login service with{" "}
                  <code>npm run service -- install</code>, then reconnect.
                </p>
                <button
                  className="button"
                  style={{ marginTop: 14 }}
                  onClick={() => void load()}
                >
                  Reconnect
                </button>
              </section>
            ) : (
              <div className="loading">
                <LoaderCircle className="spin" size={18} /> Loading your
                observatory…
              </div>
            )
          ) : tab === "runway" ? (
            <QuotaRunway
              data={data}
              now={now}
              timezone={timezone}
              unreachable={unreachable}
              activitySince={activitySince}
              selectedWindow={selectedWindow}
              onSelectWindow={setSelectedWindow}
              range={range}
              onSelectRange={setRange}
              busy={!!busy}
              onRetry={() => void action("refresh")}
              onReconnect={() => void load()}
            />
          ) : tab === "work" ? (
            <AgentsWork data={data} now={now} />
          ) : (
            <ModelsTools
              data={data}
              now={now}
              onInspectWindow={(key) => {
                setSelectedWindow(key);
                setTab("runway");
              }}
            />
          )}

          <footer className="footnote">
            <label>
              Timezone{" "}
              <select
                value={timezone}
                onChange={(e) => {
                  if (validTimezone(e.target.value)) {
                    localStorage.setItem("agy-timezone", e.target.value);
                    setTimezone(e.target.value);
                  }
                }}
              >
                {[
                  ...new Set([
                    timezone,
                    "UTC",
                    Intl.DateTimeFormat().resolvedOptions().timeZone,
                  ]),
                ].map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <span>Local metadata · Clear provenance · Zero credentials read</span>
            <span>Times in {timezone} · UTC preserved</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
