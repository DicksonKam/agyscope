import { validTimezone } from "../shared/time";

export { validTimezone };

export function timezonePreference(): string {
  const saved = localStorage.getItem("agy-timezone");
  if (saved && validTimezone(saved)) return saved;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validTimezone(local) ? local : "UTC";
}

export function date(ms: number, tz = timezonePreference()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);
}

export function shortTime(ms: number, tz = timezonePreference()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);
}

export function shortDate(ms: number, tz = timezonePreference()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
  }).format(ms);
}

export function elapsed(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function resetCountdown(reset: number | null, now: number): string {
  if (reset === null) return "Reset unavailable";
  const minutes = Math.max(0, Math.ceil((reset * 1000 - now) / 60_000));
  if (!minutes)
    return `Reset ${elapsed(reset * 1000, now).replace(" ago", "")} ago · usage since is unknown`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  return `Resets in ${days ? `${days}d ` : ""}${hours}h ${minutes % 60}m`;
}
