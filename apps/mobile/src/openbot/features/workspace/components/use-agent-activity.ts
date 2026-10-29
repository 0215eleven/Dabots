// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import { useSession } from "../../../../session/SessionProvider";
import type { MobileAgentActivity } from "../model/agent-activity";

/** What a Bot does now, from the work status DS Bot reports for the team. */
export function useAgentActivity(agentId: string): MobileAgentActivity | undefined {
  const { workspace } = useSession();
  if (!workspace.online) return undefined;
  const work = workspace.team.work;
  if (work?.approvals.some((entry) => entry.botId === agentId)) return { agentId, turnId: null, phase: "waiting", detail: null, reason: "approval" };
  const own = work?.bots[agentId];
  return own ? { agentId, turnId: null, phase: "working", detail: own.said ?? own.note ?? own.tool ?? null } : undefined;
}

export function useAgentWaitReason(agentId: string) {
  const activity = useAgentActivity(agentId);
  return activity?.phase === "waiting" ? activity.reason : undefined;
}
