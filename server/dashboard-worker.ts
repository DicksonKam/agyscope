import { Store } from "./store.ts";
import { readDashboard } from "./dashboard.ts";

// Runs in its own process with a read-only connection so dashboard queries never block the menu bar.
const store = new Store(process.argv[2], true);
process.on(
  "message",
  (message: { id: number; query: Parameters<typeof readDashboard>[1] }) => {
    try {
      process.send?.({
        id: message.id,
        result: readDashboard(store, message.query),
      });
    } catch {
      process.send?.({ id: message?.id, error: true });
    }
  },
);
process.on("disconnect", () => {
  store.close();
  process.exit(0);
});
