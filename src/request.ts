import type { ActionResponse } from "../shared/api";

export class DashboardRequests {
  private sequence = 0;
  private activeRead: number | null = null;
  private activeKey = "";
  private actionInFlight = false;

  beginRead(key: string): number | null {
    if (this.activeRead !== null && this.activeKey === key) return null;
    const next = ++this.sequence;
    this.activeRead = next;
    this.activeKey = key;
    return next;
  }

  isCurrent(seq: number): boolean {
    return seq === this.sequence;
  }

  endRead(seq: number) {
    if (this.activeRead === seq) {
      this.activeRead = null;
      this.activeKey = "";
    }
  }

  beginAction(): boolean {
    if (this.actionInFlight) return false;
    this.actionInFlight = true;
    return true;
  }

  endAction() {
    this.actionInFlight = false;
  }
}

export async function performAction(
  path: string,
  payload: unknown,
  csrf: string,
): Promise<ActionResponse> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AGYScope-Token": csrf,
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as ActionResponse;
  if (!res.ok) {
    throw new Error(data.error ?? "The service refused the request.");
  }
  return data;
}
