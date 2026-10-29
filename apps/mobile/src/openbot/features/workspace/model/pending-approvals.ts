// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
/** An approval an agent waits on. DS Bot answers approvals on the computer, so the phone only shows them. */
export interface PendingApproval {
  requestId: string | number;
  agentId: string;
  threadId?: string | null;
  turnId?: string | null;
  kind?: string;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  grantRoot: string | null;
}
