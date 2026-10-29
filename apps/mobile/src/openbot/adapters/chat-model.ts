// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
// Maps this app's SDK messages and outbox onto the view models the OpenBot chat components draw.
import type { Message } from "@ds-bot/mobile-sdk";
import type { OutboxItem } from "../../outbox/outbox";
import type { Bot, Room, TeamState } from "../../types";
import type { ChatBubbleMessage, ChatMessage } from "@/features/chat/model/chat-messages";
import type { OutboxRowStatus } from "@/features/chat/components/chat-outbox-status";
import type { ChatTarget } from "@/features/chat/model/chat-target";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export const outboxRowId = (requestId: string) => `outbox:${requestId}`;

const iso = (value: number | string | undefined) => {
  const time = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : undefined;
};

export function agentFor(bot: Bot, serverId: string): MobileAgent {
  return {
    id: bot.id, serverId, name: bot.name, title: bot.role ?? "", description: bot.instructions ?? "", preview: "",
    updatedLabel: "", avatarSeed: bot.id, avatarHue: null, bot, ...(bot.model ? { model: bot.model } : {}),
  };
}

/** The transcript as OpenBot message rows. Tool and system rows are not drawn; the activity row covers them. */
export function toChatMessages(messages: readonly Message[], bots: readonly Bot[]): ChatMessage[] {
  const rows: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!message.text && !message.attachments?.length) continue;
    const author = message.role === "user" ? "user" : "agent";
    const named = typeof message.author === "object" && message.author ? (message.author as { id?: string; name?: string }) : undefined;
    const bot = named?.id ? bots.find((entry) => entry.id === named.id) : undefined;
    const createdAt = iso(message.createdAt);
    const row: ChatBubbleMessage = {
      id: message.id, kind: "message", author, body: message.text, streaming: Boolean(message.pending),
      ...(createdAt ? { createdAt } : {}),
      ...(author === "agent" && named?.id ? { speaker: { kind: "agent" as const, id: named.id, name: bot?.name ?? named.name ?? named.id } } : {}),
    };
    rows.push(row);
  }
  return rows;
}

/** Messages the host has not echoed yet, drawn like sent ones but lighter, with their status. */
export function pendingChatMessages(outgoing: readonly OutboxItem[], echoed: ReadonlySet<string>) {
  const messages: ChatMessage[] = [];
  const waiting: OutboxItem[] = [];
  for (const item of [...outgoing].sort((a, b) => a.createdAt - b.createdAt)) {
    if (echoed.has(item.requestId)) continue;
    // Accepted by the host: the transcript row is about to arrive; draw it as a normal sent message.
    messages.push({ id: outboxRowId(item.requestId), kind: "message", author: "user", body: item.text, streaming: false, createdAt: new Date(item.createdAt).toISOString() });
    if (item.state !== "sent") waiting.push(item);
  }
  return { messages, waiting };
}

export function outboxStatuses(
  waiting: readonly OutboxItem[],
  online: boolean,
  actions: { retry(requestId: string): void; edit(requestId: string): void; cancel(requestId: string): void },
): Map<string, OutboxRowStatus> {
  const lastWaiting = waiting.filter((item) => item.state === "queued" || item.state === "sending").at(-1);
  const map = new Map<string, OutboxRowStatus>();
  for (const item of waiting) {
    const failed = item.state === "unconfirmed" || item.state === "rejected";
    map.set(outboxRowId(item.requestId), {
      message: { clientMessageId: item.requestId, text: item.text, state: failed ? "failed" : "waiting", error: item.error ?? null, retryable: item.state !== "rejected" },
      online,
      showStatus: failed || item === lastWaiting,
      retry: () => actions.retry(item.requestId),
      edit: () => actions.edit(item.requestId),
      cancel: () => actions.cancel(item.requestId),
    });
  }
  return map;
}

export function chatTarget(id: string, serverId: string, name: string, bots: readonly Bot[], room: Room | undefined, team: Pick<TeamState, "bots">): ChatTarget {
  if (room) return { kind: "channel", id, serverId, name, members: room.members.flatMap((memberId) => { const bot = team.bots.find((entry) => entry.id === memberId); return bot ? [agentFor(bot, serverId)] : []; }) };
  const bot = bots.find((entry) => entry.id === id);
  return { kind: "agent", id, serverId, name, avatarSeed: bot?.id ?? id, avatarHue: null };
}
