// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).

export type AvatarMood = "idle" | "working" | "waiting" | "failed" | "responded" | "connecting" | "asleep";
/** What a waiting agent needs from the user. */
export type MobileAgentWaitReason = "question" | "approval" | "takeover";

/** What an agent is doing now, from the work status the host reports. */
export interface MobileAgentActivity {
  agentId?: string;
  turnId: string | null;
  threadId?: string;
  phase: "working" | "responding" | "waiting";
  detail: string | null;
  /** Set only while `phase` is `waiting`. */
  reason?: MobileAgentWaitReason;
}

export function agentActivityMood(activity: MobileAgentActivity | undefined): AvatarMood {
  if (!activity) return "idle";
  return activity.phase === "waiting" ? "waiting" : "working";
}
