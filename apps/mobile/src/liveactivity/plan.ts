import type { TeamState } from "../types.ts";
import { workDescription } from "../logic/group-work.ts";

/** What the Dynamic Island and Lock Screen show. Plain JSON: it crosses into the widget extension. */
export interface BotActivityState {
  phase: "running" | "waiting" | "done" | "offline";
  /** Name of the Bot (or "3 Bots") the phase describes. */
  title: string;
  detail: string;
  /** Number of Bots working or waiting. */
  count: number;
  /** Epoch ms the oldest running Bot started; drives the elapsed timer. */
  since: number;
  /** Computer the Bots run on. */
  host: string;
}
export type ActivityStep =
  | { type: "none" }
  | { type: "start"; state: BotActivityState }
  | { type: "update"; state: BotActivityState }
  | { type: "end"; state: BotActivityState };

/** Reduce workspace work status to one activity state; null when nothing is running or waiting. */
export function summarizeWork(team: TeamState, host: string, offline = false): BotActivityState | null {
  const bots = Object.entries(team.work?.bots ?? {});
  const approvals = team.work?.approvals ?? [];
  const name = (id: string) => team.bots.find(bot => bot.id === id)?.name || id;
  const running = bots.filter(([, work]) => !work.switching);
  if (!running.length && !approvals.length) return null;
  const waiting = approvals.length > 0;
  const subjects = waiting ? [...new Set(approvals.map(item => item.botId))] : running.map(([id]) => id);
  const first = running[0]?.[1];
  const since = Math.min(...running.map(([, work]) => work.since || Infinity).filter(Number.isFinite), Infinity);
  return {
    phase: offline ? "offline" : waiting ? "waiting" : "running",
    title: subjects.length === 1 ? name(subjects[0]) : `${subjects.length} Bots`,
    detail: waiting ? "" : (workDescription(first) || first?.tool || ""),
    count: subjects.length,
    since: Number.isFinite(since) ? since : 0,
    host,
  };
}

const same = (a: BotActivityState, b: BotActivityState) => a.phase === b.phase && a.title === b.title && a.detail === b.detail && a.count === b.count && a.since === b.since && a.host === b.host;

/**
 * Decides the next ActivityKit call. Updates of identical content are dropped, and a finished run
 * ends the activity with a "done" frame so the Lock Screen does not keep showing a stale spinner.
 */
export function planActivity(previous: BotActivityState | null, next: BotActivityState | null): ActivityStep {
  if (!next) return previous && previous.phase !== "done" ? { type: "end", state: { ...previous, phase: "done", detail: "" } } : { type: "none" };
  if (!previous || previous.phase === "done") return { type: "start", state: next };
  return same(previous, next) ? { type: "none" } : { type: "update", state: next };
}
