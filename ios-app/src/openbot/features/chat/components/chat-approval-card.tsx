// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import type { PendingApproval } from "@legacy/features/workspace/model/pending-approvals";

export type ApprovalDecision = "accept" | "decline";
export function approvalTitle(approval: PendingApproval, _t?: unknown): string {
  return approval.reason ?? approval.command ?? "";
}
export function ChatApprovalCard(_props: any) {
  return null;
}
