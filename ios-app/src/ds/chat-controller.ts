import { mergeMessages, type Message } from '@ds-bot/mobile-sdk';
import type { DsCore, DsMessage } from './contracts.ts';
import { dsId } from './identity.ts';
import { projectTranscript } from './projection.ts';
import { mutationProblem } from './screen-binding.ts';
export interface ChatScreenState {
    messages: DsMessage[]; ready: boolean; error: string; cursor: string | null;
    olderLoading: boolean; olderError: boolean;
}
/** One owner/conversation. Raw SDK rows retain ordering, versions and receipt semantics. */
export function createChatBinding(core: DsCore, id: string) {
    const owner = core.read();
    const target = [...owner.conversations, ...owner.agents].find(conversation => conversation.id === id);
    if (!target) throw Error('This conversation is no longer visible.');
    let state: ChatScreenState = { messages: [], ready: false, error: '', cursor: null, olderLoading: false, olderError: false };
    let active = true, started = false, foreground = true, liveRevision = 0, sessionRevision = 0;
    let sessionId: string | undefined, loadedOlder = false, hasHistory = false, streamEstablished = false;
    let cached: Message[] = [], canonical: Message[] = [], transient: Message[] = [];
    const liveAt = new Map<string, number>();
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const publish = (patch: Partial<ChatScreenState>) => { if (!active) return; state = { ...state, ...patch }; for (const listener of listeners) listener(); };
    const inSession = (rows: Message[]) => sessionId ? rows.filter(message => dsId(owner.serverId, 'session', message.sessionId) === sessionId) : rows;
    function publishRows(patch: Partial<ChatScreenState> = {}) {
        const rows = mergeMessages(mergeMessages(cached, canonical), transient);
        publish({ messages: projectTranscript(owner.serverId, target!.source, rows), ready: hasHistory || streamEstablished || cached.length > 0, ...patch });
    }
    function changeSession(next?: string) {
        if (!next || sessionId === next) return;
        const rollover = sessionId !== undefined;
        sessionId = next;
        sessionRevision++;
        cached = inSession(cached);
        // The first authoritative session also filters provisional cache/rows.
        canonical = rollover ? [] : inSession(canonical);
        transient = rollover ? [] : inSession(transient);
        if (rollover) {
            loadedOlder = false; hasHistory = false; streamEstablished = false; liveAt.clear();
            publish({ cursor: null, olderLoading: false, olderError: false });
        }
    }
    async function load(older = false) {
        if (!active || !foreground || older && state.olderLoading) return;
        const generation = sessionRevision, version = liveRevision, cursor = state.cursor;
        const requestSession = sessionId ?? dsId(owner.serverId, 'session', target!.source.sessionId);
        if (older) publish({ olderLoading: true, olderError: false });
        try {
            const page = await core.history(id, older ? { cursor } : {});
            if (!active || sessionId && sessionId !== page.sessionId && (generation !== sessionRevision || version !== liveRevision)) return;
            changeSession(page.sessionId);
            const rows = inSession(page.messages.map(message => message.ds.source));
            const newerLive = canonical.filter(message => (liveAt.get(message.id) ?? -1) > version);
            const stable = rows.filter(message => !message.pending);
            canonical = older ? mergeMessages(stable, canonical) : mergeMessages(mergeMessages(canonical, stable), newerLive);
            if (!streamEstablished && !older) transient = rows.filter(message => message.pending);
            cached = []; hasHistory = true;
            if (older) loadedOlder = true;
            publishRows({ cursor: older || !loadedOlder ? page.cursor : state.cursor, error: '' });
        } catch (error) { if (generation === sessionRevision || requestSession === sessionId) publish({ error: mutationProblem(error).message, olderError: older }); }
        finally { if (generation === sessionRevision || !older) publish({ olderLoading: false }); }
    }
    function acquire() {
        if (!active || !started || !foreground || release || !core.capabilities().stream) return;
        try {
            release = core.watchConversation(id, {
                onSnapshot(snapshot) {
                    if (!active) return;
                    changeSession(snapshot.sessionId ?? snapshot.messages[0]?.ds.sessionId);
                    // ready/heartbeat sequence and cursor metadata do not establish a transcript.
                    if (!snapshot.established && !snapshot.messages.length) { publishRows(); return; }
                    streamEstablished = true;
                    liveRevision++;
                    const rows = inSession(snapshot.messages.map(message => message.ds.source));
                    const stable = rows.filter(message => !message.pending);
                    for (const message of stable) liveAt.set(message.id, liveRevision);
                    canonical = mergeMessages(canonical, stable);
                    // Pool snapshots already applied SDK replacement/reset/clearAttempt semantics.
                    // Historical canonical pages survive, but absent stream transients must not.
                    transient = rows.filter(message => message.pending);
                    cached = cached.filter(message => !message.pending);
                    publishRows({ ...(loadedOlder || snapshot.cursor === undefined ? {} : { cursor: snapshot.cursor }), error: '' });
                },
                onError: error => publish({ error: mutationProblem(error).message }),
            });
        } catch (error) { publish({ error: mutationProblem(error).message }); }
    }
    return {
        get: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        setError: (error: string) => publish({ error }), load,
        start() {
            if (started || !active) return;
            started = true;
            void core.cachedHistory(id).then(messages => {
                if (!active || hasHistory) return;
                cached = inSession(messages.map(message => message.ds.source)).filter(message => !streamEstablished || !message.pending);
                publishRows();
            }).catch(error => publish({ error: mutationProblem(error).message }));
            if (foreground && core.capabilities().history) void load();
            acquire();
        },
        setForeground(value: boolean) {
            if (!active || foreground === value) return;
            foreground = value;
            if (!value) { release?.(); release = undefined; }
            else { acquire(); if (started && core.capabilities().history) void load(); }
        },
        dispose() { active = false; release?.(); release = undefined; listeners.clear(); },
    };
}
