import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type ConnectionStatus, type Message, mergeMessages } from "@ds-bot/mobile-sdk";
import { useSession } from "../session/SessionProvider";
import { conversationStreams } from "../logic/conversation-streams";
import { useScreenActivity } from "../components/ScreenActivity";
import { cache, readCache, writeCache } from "../storage";
import { errorText } from "../types";

const CURSOR_FLUSH_MS = 1000;
const EMPTY: never[] = [];

/**
 * One conversation: cached transcript first, then the live stream resumed from the stored cursor,
 * plus the outbox view. The stream, not this hook, owns reconnection.
 */
export function useChat(id: string) {
  const { client, host, outbox, foreground } = useSession();
  const focused = useScreenActivity();
  const [messages, setMessages] = useState<Message[]>(() => (client && host ? conversationStreams.peek(client, host.serverId, id)?.snapshot.messages : undefined) ?? EMPTY);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [older, setOlder] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraftState] = useState("");
  const draftRef = useRef("");
  const serverId = host?.serverId;

  // Cached transcript and draft.
  useEffect(() => {
    if (!serverId) return;
    let active = true;
    void Promise.all([cache.getMessages(serverId, id), cache.getDraft(serverId, id)]).then(([saved, text]) => {
      if (!active) return;
      setMessages(previous => mergeMessages(saved, previous));
      if (!draftRef.current) { draftRef.current = text; setDraftState(text); }
    }).catch(() => {});
    return () => { active = false; };
  }, [serverId, id]);

  // Live stream, resumed from the persisted cursor when a transcript is cached.
  useEffect(() => {
    if (!client || !serverId || !foreground || !focused) return;
    let active = true;
    let lease: ReturnType<typeof conversationStreams.acquire> | undefined;
    let flush: ReturnType<typeof setTimeout> | undefined;
    let pending: number | undefined;
    const persist = () => {
      flush = undefined;
      if (pending !== undefined) void writeCache(serverId, `cursor:${id}`, pending).catch(() => {});
      pending = undefined;
    };
    const request = new AbortController();
    void (async () => {
      const [saved, cursor] = await Promise.all([
        cache.getMessages(serverId, id).catch(() => [] as Message[]),
        readCache<number>(serverId, `cursor:${id}`).catch(() => null),
      ]);
      if (!active) return;
      const after = saved.length && typeof cursor === "number" ? cursor : undefined;
      try {
        lease = conversationStreams.acquire(client, serverId, id, {
          onStatus: value => { if (active) setStatus(value); },
          onError: err => { if (active) setError(errorText(err)); },
          onSnapshot: snapshot => {
            if (!active) return;
            setRunning(snapshot.running);
            setError("");
            setMessages(previous => mergeMessages(previous.some(item => item.pending) ? previous.filter(item => !item.pending) : previous, snapshot.messages));
            if (snapshot.cursor !== undefined) setOlder(previous => previous ?? snapshot.cursor ?? null);
            if (snapshot.eventSeq !== undefined && snapshot.eventSeq !== pending) {
              pending = snapshot.eventSeq;
              flush ??= setTimeout(persist, CURSOR_FLUSH_MS);
            }
          },
        }, after === undefined ? {} : { after });
      } catch (err) { setError(errorText(err)); }
      // History and the stream are independent: a slow page never delays the live handshake.
      void client.messages(id, { signal: request.signal }).then(page => {
        if (!active) return;
        lease?.remember(page.messages, page.cursor);
        setMessages(previous => mergeMessages(previous, page.messages));
        setOlder(page.cursor);
      }).catch(err => { if (active && !request.signal.aborted) setError(errorText(err)); });
    })();
    return () => {
      active = false;
      request.abort();
      clearTimeout(flush);
      if (pending !== undefined) void writeCache(serverId, `cursor:${id}`, pending).catch(() => {});
      lease?.release();
    };
  }, [client, serverId, id, foreground, focused]);

  // Re-render when the outbox changes; its items are read fresh below.
  useSyncExternalStore(
    useCallback(listener => outbox?.subscribe(listener) ?? (() => {}), [outbox]),
    () => outbox?.version ?? 0,
  );

  // Rows the host has echoed no longer need the outbox.
  useEffect(() => { void outbox?.settle(id, messages); }, [messages, outbox, id]);

  const setDraft = useCallback((text: string) => {
    draftRef.current = text;
    setDraftState(text);
    if (serverId) void cache.setDraft(serverId, id, text).catch(() => {});
  }, [serverId, id]);

  const send = useCallback(async () => {
    if (!outbox) return false;
    const text = draftRef.current;
    if (!text.trim()) return false;
    draftRef.current = "";
    setDraftState("");
    if (serverId) void cache.setDraft(serverId, id, "").catch(() => {});
    const item = await outbox.enqueue({ conversationId: id, text });
    if (!item) { draftRef.current = text; setDraftState(text); return false; }
    return true;
  }, [outbox, serverId, id]);

  const loadOlder = useCallback(async () => {
    if (!client || !older || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await client.messages(id, { cursor: older });
      setMessages(previous => mergeMessages(page.messages, previous));
      setOlder(page.cursor);
    } catch (err) { setError(errorText(err)); }
    finally { setLoadingOlder(false); }
  }, [client, id, older, loadingOlder]);

  const stop = useCallback(async () => {
    try { await client?.cancel(id); } catch (err) { setError(errorText(err)); }
  }, [client, id]);

  return {
    messages, outgoing: outbox?.list(id) ?? [], status, running, error, draft, setDraft, send, loadOlder, hasOlder: !!older, loadingOlder, stop,
    retry: (requestId: string) => outbox?.retry(requestId),
    discard: (requestId: string) => outbox?.discard(requestId),
  };
}
