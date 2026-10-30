import { useEffect, useMemo, useState } from "react";
import type { Conversation, Message } from "@ds-bot/mobile-sdk";
import { useSession } from "../session/SessionProvider";
import { cache } from "../storage";
import { orderConversations } from "../logic/conversation-order";

export interface PreviewAccess {
  owner: object | null;
  allowed: boolean;
  read(conversationId: string): Promise<Message[]>;
}
const EMPTY: Record<string, Message> = Object.freeze({});
/** DS callers supply guarded history access; legacy callers retain their cache API. */
export function usePreviews(conversations: Conversation[], access?: PreviewAccess) {
  const { client, host, workspace } = useSession();
  const activity = JSON.stringify(conversations.map(item => [item.id, item.sessionId, item.updatedAt]));
  const serverId = host?.serverId;
  const scope = useMemo(() => ({ serverId, client, access }), [serverId, client, access]);
  const [state, setState] = useState<{ scope: typeof scope | null; items: Record<string, Message> }>({ scope: null, items: EMPTY });
  useEffect(() => {
    if (!serverId || (access && !access.allowed)) return;
    let alive = true;
    const controller = new AbortController();
    void Promise.all(orderConversations(conversations, {}, () => false).slice(0, 20).map(async item => {
      let messages = access ? await access.read(item.id).catch(() => [] as Message[]) : await cache.getMessages(serverId, item.id).catch(() => [] as Message[]);
      if (!access && workspace.online && client) {
        try { messages = (await client.messages(item.id, { limit: 6, signal: controller.signal })).messages; }
        catch { /* Keep the cached preview when a read fails. */ }
      }
      const latest = [...messages].reverse().find(message => !message.pending && ["assistant", "user"].includes(message.role) && (!!message.text || !!message.attachments?.length));
      return latest ? [item.id, latest] as const : null;
    })).then(rows => {
      if (!alive) return;
      setState({ scope, items: Object.fromEntries(rows.filter(row => row !== null)) });
    }).catch(() => {});
    return () => { alive = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, workspace.online, activity]);
  return state.scope === scope && (!access || access.allowed) ? state.items : EMPTY;
}
