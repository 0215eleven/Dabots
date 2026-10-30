// The paired computers the phone is not showing right now. Each one is watched in the background
// over its own client (the app's shared client of that computer), so the home list can show every
// computer's chats and whether each computer is online.
import type { Conversation, Message, MobileClient } from "@ds-bot/mobile-sdk";
import { teamState, type TeamState } from "../types.ts";
import { conversationTime, conversationTimestamp } from "./conversation-order.ts";
import { projectBot, projectGroup } from "../ds/projection.ts";
import { dsId } from "../ds/identity.ts";

export interface PeerPreview { text: string; at: number }
export interface PeerState {
  serverId: string;
  /** null until the first answer or failure. */
  online: boolean | null;
  error: string;
  team: TeamState | null;
  conversations: Conversation[];
  previews: Record<string, PeerPreview>;
}
export interface PeerRow {
  /** The DS identity the chat routes open, unique across computers. */
  id: string;
  serverId: string;
  kind: "bot" | "group";
  name: string;
  title: string;
  preview: string;
  at: number;
  avatar: { seed: string; color: string | null; members: { seed: string; color: string | null }[] };
}

const PREVIEW_LIMIT = 20;

export function emptyPeer(serverId: string): PeerState {
  return { serverId, online: null, error: "", team: null, conversations: [], previews: {} };
}

/**
 * Reads one computer: state, conversation list and identity in one round, then the latest message
 * of its most recent conversations. Previews are read again only for conversations that changed.
 */
export function createPeerWatcher(options: {
  serverId: string;
  client: MobileClient;
  readCache(serverId: string, key: string): Promise<unknown>;
  writeCache(serverId: string, key: string, value: unknown): Promise<void>;
  onChange(state: PeerState): void;
}) {
  const { serverId, client } = options;
  let state = emptyPeer(serverId);
  let disposed = false;
  let pending: Promise<void> | null = null;
  const seen = new Map<string, string>();
  const publish = (next: Partial<PeerState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    options.onChange(state);
  };

  async function loadCache() {
    const [team, conversations] = await Promise.all([options.readCache(serverId, "team"), options.readCache(serverId, "conversations")]).catch(() => [null, null]);
    if (disposed || state.team) return;
    publish({ team: team && typeof team === "object" ? teamState(team as Record<string, unknown>) : null, conversations: Array.isArray(conversations) ? conversations as Conversation[] : [] });
  }

  async function readPreviews(list: Conversation[], history: boolean) {
    if (!history) return;
    const recent = [...list].filter(item => item.kind === "bot" || item.kind === "room")
      .sort((a, b) => conversationTime(b) - conversationTime(a)).slice(0, PREVIEW_LIMIT);
    const changed = recent.filter(item => seen.get(item.id) !== `${item.sessionId}:${item.updatedAt ?? ""}`);
    if (!changed.length) return;
    const rows = await Promise.all(changed.map(async item => {
      try {
        const page = await client.messages(item.id, { limit: 6 });
        seen.set(item.id, `${item.sessionId}:${item.updatedAt ?? ""}`);
        const latest = [...page.messages].reverse().find((message: Message) => !message.pending && ["assistant", "user"].includes(message.role) && !!message.text);
        return latest ? [item.id, { text: latest.text.trim(), at: conversationTimestamp(latest.createdAt) }] as const : null;
      } catch { return null; }
    }));
    if (disposed) return;
    const previews = { ...state.previews };
    for (const row of rows) if (row) previews[row[0]] = row[1];
    publish({ previews });
  }

  async function read() {
    try {
      const [raw, list, info] = await Promise.all([client.state(), client.conversations(), client.info()]);
      if (disposed) return;
      if (info.serverId !== serverId) throw new Error("This address now answers as another computer.");
      const capabilities = info.capabilities && !Array.isArray(info.capabilities) ? info.capabilities : {};
      const team = teamState({ ...raw, mobileCapabilities: capabilities });
      publish({ online: true, error: "", team, conversations: list.conversations });
      void options.writeCache(serverId, "team", team).catch(() => {});
      void options.writeCache(serverId, "conversations", list.conversations).catch(() => {});
      await readPreviews(list.conversations, capabilities.history === true);
    } catch (error) {
      publish({ online: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    get state() { return state; },
    async start() { await loadCache(); await this.refresh(); },
    /** One read at a time; a refresh during a read joins it. */
    refresh() {
      if (disposed) return Promise.resolve();
      pending ??= read().finally(() => { pending = null; });
      return pending;
    },
    dispose() { disposed = true; },
  };
}

/** The chat rows of a watched computer, newest first, without hidden chats or Agent conversations. */
export function peerRows(peer: PeerState, color: (bot: TeamState["bots"][number]) => string | null): PeerRow[] {
  const team = peer.team;
  if (!team) return [];
  const byId = new Map(team.bots.map(bot => [bot.id, bot]));
  const timeOf = (conversation: Conversation | undefined) => {
    if (!conversation) return 0;
    return Math.max(conversationTime(conversation), peer.previews[conversation.id]?.at ?? 0);
  };
  const find = (id: string | null) => id ? peer.conversations.find(item => dsId(peer.serverId, "conversation", item.id) === id) : undefined;
  const bots = team.bots.filter(bot => !bot.hidden).map(bot => {
    const view = projectBot(peer.serverId, bot, peer.conversations);
    const conversation = find(view.conversationId);
    return { id: view.id, serverId: peer.serverId, kind: "bot" as const, name: bot.name, title: bot.role ?? "",
      preview: conversation ? peer.previews[conversation.id]?.text ?? "" : "", at: timeOf(conversation),
      avatar: { seed: bot.avatar?.shape ?? bot.id, color: color(bot), members: [] } };
  });
  const groups = team.rooms.filter(room => !room.hidden).map(room => {
    const view = projectGroup(peer.serverId, room, peer.conversations);
    const conversation = find(view.conversationId);
    const members = room.members.flatMap(id => { const bot = byId.get(id); return bot ? [{ seed: bot.avatar?.shape ?? bot.id, color: color(bot) }] : []; }).slice(0, 3);
    return { id: view.id, serverId: peer.serverId, kind: "group" as const, name: room.name, title: "",
      preview: conversation ? peer.previews[conversation.id]?.text ?? "" : "", at: timeOf(conversation),
      avatar: { seed: room.id, color: null, members } };
  });
  return [...bots, ...groups].sort((a, b) => b.at - a.at);
}
