import { useEffect, useState } from "react";
import type { Conversation, Message } from "@ds-bot/mobile-sdk";
import { useSession } from "../session/SessionProvider";
import { cache } from "../storage";
import { orderConversations } from "../logic/conversation-order";

/** Latest visible message per conversation: cached first, refreshed from the host when online. */
export function usePreviews(conversations: Conversation[]) {
  const { client, host, workspace } = useSession();
  const [state, setState] = useState<{ serverId: string; items: Record<string, Message> }>({ serverId: "", items: {} });
  const activity = JSON.stringify(conversations.map(item => [item.id, item.sessionId, item.updatedAt]));
  const serverId = host?.serverId;
  useEffect(() => {
    if (!serverId) return;
    let alive = true;
    const controller = new AbortController();
    void Promise.all(orderConversations(conversations, {}, () => false).slice(0, 20).map(async item => {
      let messages = await cache.getMessages(serverId, item.id).catch(() => [] as Message[]);
      if (workspace.online && client) {
        try { messages = (await client.messages(item.id, { limit: 6, signal: controller.signal })).messages; }
        catch { /* Keep the cached preview when a read fails. */ }
      }
      const latest = [...messages].reverse().find(message => !message.pending && ["assistant", "user"].includes(message.role) && (!!message.text || !!message.attachments?.length));
      return latest ? [item.id, latest] as const : null;
    })).then(rows => {
      if (!alive) return;
      setState(previous => ({
        serverId,
        items: { ...(previous.serverId === serverId ? previous.items : {}), ...Object.fromEntries(rows.filter(row => row !== null)) },
      }));
    }).catch(() => {});
    return () => { alive = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, client, workspace.online, activity]);
  return state.serverId === serverId ? state.items : {};
}
