import type {
  DashboardResponse,
  DashboardState,
  DashboardStatus,
} from "../shared/api";

export async function requestDashboard(
  query: string,
): Promise<
  | { partial: false; data: DashboardResponse }
  | { partial: true; data: DashboardStatus }
> {
  const res = await fetch(`/api/state?${query}`, { cache: "no-store" });
  if (res.ok) {
    return { partial: false, data: (await res.json()) as DashboardResponse };
  }
  const fallback = await fetch("/api/status", { cache: "no-store" });
  if (fallback.ok) {
    return { partial: true, data: (await fallback.json()) as DashboardStatus };
  }
  throw new Error("Unable to reach AGYScope service");
}

export function mergeDashboardStatus(
  previous: DashboardState | null,
  status: DashboardStatus,
): DashboardState {
  return {
    ...(previous ?? {}),
    ...status,
    detailsDelayed: !previous?.coverage,
  };
}
