// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
/** An outgoing message as the chat shows it. The app's outbox (src/outbox) owns the real queue. */
export interface OutboxMessage {
  clientMessageId: string;
  text: string;
  state: "waiting" | "failed";
  error: string | null;
  /** The host never received it, or answers a repeat with its first receipt: a retry cannot send twice. */
  retryable: boolean;
}

export function outboxRetrySafe(message: OutboxMessage, _now: number): boolean {
  return message.retryable;
}
