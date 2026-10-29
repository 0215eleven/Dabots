import { Platform } from "react-native";
import { planActivity, summarizeWork, type BotActivityState } from "./plan";
import type { TeamState } from "../types";

// ActivityKit may only start an activity while the app is in the foreground, and updates arrive
// only while the app runs (the sockets close in the background). The staleDate makes iOS render
// the "stale" variant when the app can no longer vouch for the state.
const STALE_MS = 3 * 60 * 1000;
let current: { state: BotActivityState; handle: { update(p: BotActivityState, stale?: Date): Promise<void>; end(policy?: "default" | "immediate", p?: BotActivityState): Promise<void> } } | null = null;
let queue: Promise<void> = Promise.resolve();
let enabled = true;

async function factory() {
  if (Platform.OS !== "ios") return null;
  try { return (await import("./BotActivity")).default; } catch { return null; }
}

/** Keep the Dynamic Island in step with what the Bots are doing. Safe to call on every workspace refresh. */
export function syncBotActivity(team: TeamState, host: string, offline = false) {
  if (Platform.OS !== "ios" || !enabled) return Promise.resolve();
  queue = queue.then(async () => {
    const step = planActivity(current?.state ?? null, summarizeWork(team, host, offline));
    if (step.type === "none") return;
    const activity = await factory();
    if (!activity) return;
    try {
      if (step.type === "start") {
        const existing = activity.getInstances()[0];
        const handle = existing ?? activity.start(step.state, "dsbot://", new Date(Date.now() + STALE_MS));
        if (existing) await existing.update(step.state, new Date(Date.now() + STALE_MS));
        current = { state: step.state, handle };
      } else if (step.type === "update" && current) {
        await current.handle.update(step.state, new Date(Date.now() + STALE_MS));
        current = { ...current, state: step.state };
      } else if (step.type === "end" && current) {
        await current.handle.end("default", step.state);
        current = null;
      }
    } catch {
      // Live Activities can be disabled by the user or exhausted by the system; chat never depends on them.
      current = null;
    }
  });
  return queue;
}

/** Called when the phone loses the stream for good (logout, switching computers). */
export function endBotActivity() {
  queue = queue.then(async () => {
    const handle = current?.handle;
    current = null;
    if (!handle) return;
    try { await handle.end("immediate"); } catch { /* Already gone. */ }
  });
  return queue;
}

/** The user can turn the Dynamic Island off in Settings; turning it off ends a running activity. */
export function setLiveActivityEnabled(value: boolean) {
  enabled = value;
  if (!value) void endBotActivity();
}
export const liveActivityEnabled = () => enabled;
