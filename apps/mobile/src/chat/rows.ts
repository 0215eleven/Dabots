import type { Message } from "@ds-bot/mobile-sdk";
import type { OutboxItem, OutboxState } from "../outbox/outbox";

/** What the sender sees under their own bubble. */
export type SendState = "sending" | "sent" | "failed" | "rejected";
export interface ChatRow {
  key: string;
  message: Message;
  /** Present only for messages still owned by the outbox. */
  send?: { state: SendState; requestId: string; error?: string };
}

const sendState = (state: OutboxState): SendState =>
  state === "sent" ? "sent" : state === "rejected" ? "rejected" : state === "unconfirmed" ? "failed" : "sending";

/**
 * Canonical transcript (already ordered by the SDK) followed by outgoing messages the host has
 * not echoed yet, oldest first. The SDK's "accepted:" placeholder yields to the real row.
 */
export function chatRows(messages: Message[], outgoing: OutboxItem[]): ChatRow[] {
  const real = new Set(messages.filter(message => !message.localSubmission).map(message => message.requestId).filter(Boolean));
  const transcript: ChatRow[] = messages
    .filter(message => !(message.localSubmission && message.requestId && real.has(message.requestId)))
    .map(message => ({ key: message.id, message }));
  const placeholders = new Set(transcript.filter(row => row.message.localSubmission).map(row => row.message.requestId));
  const pending: ChatRow[] = outgoing
    .filter(item => !real.has(item.requestId) && !placeholders.has(item.requestId))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(item => ({
      key: `outbox:${item.requestId}`,
      message: { id: `outbox:${item.requestId}`, sessionId: item.sessionId ?? "", seq: Number.MAX_SAFE_INTEGER, role: "user", text: item.text, attachments: item.attachments, createdAt: item.createdAt, requestId: item.requestId },
      send: { state: sendState(item.state), requestId: item.requestId, ...(item.error ? { error: item.error } : {}) },
    }));
  return [...transcript, ...pending];
}
