import type { DsCore, DsMessage } from './contracts.ts';
import { mutationProblem } from './screen-binding.ts';
export interface ChatScreenState {
    messages: DsMessage[]; ready: boolean; error: string; cursor: string | null;
    olderLoading: boolean; olderError: boolean;
}
/** Prepend history while current/live rows win overlapping IDs. */
function historyBefore(history: DsMessage[], current: DsMessage[]) {
    const ids = new Set(current.map(message => message.id));
    return [...history.filter(message => !ids.has(message.id)), ...current];
}
function liveOver(current: DsMessage[], incoming: DsMessage[]) {
    const updates = new Map(incoming.map(message => [message.id, message]));
    const ids = new Set(current.map(message => message.id));
    return [...current.map(message => updates.get(message.id) ?? message), ...incoming.filter(message => !ids.has(message.id))];
}
/** One owner/conversation, with a foreground lease independent of cached/history pages. */
export function createChatBinding(core: DsCore, id: string) {
    let state: ChatScreenState = { messages: [], ready: false, error: '', cursor: null, olderLoading: false, olderError: false };
    let active = true, started = false, foreground = true, liveRevision = 0, sessionRevision = 0;
    let sessionId: string | undefined, loadedOlder = false;
    const liveAt = new Map<string, number>();
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const publish = (patch: Partial<ChatScreenState>) => { if (!active) return; state = { ...state, ...patch }; for (const listener of listeners) listener(); };
    function changeSession(next?: string) {
        if (!next) return;
        if (sessionId && sessionId !== next) {
            sessionRevision++; loadedOlder = false; liveAt.clear();
            publish({ messages: [], cursor: null, ready: false, olderLoading: false, olderError: false });
        }
        sessionId = next;
    }
    async function load(older = false) {
        if (!active || !foreground || older && state.olderLoading) return;
        const generation = sessionRevision, version = liveRevision, cursor = state.cursor;
        if (older) publish({ olderLoading: true, olderError: false });
        try {
            const page = await core.history(id, older ? { cursor } : {});
            if (!active || generation !== sessionRevision || sessionId && sessionId !== page.sessionId && version !== liveRevision) return;
            changeSession(page.sessionId);
            if (older) loadedOlder = true;
            const newerLive = state.messages.filter(message => (liveAt.get(message.id) ?? -1) > version);
            const messages = older ? historyBefore(page.messages, state.messages) : version !== liveRevision || loadedOlder ? liveOver(liveOver(state.messages, page.messages), newerLive) : page.messages;
            publish({ messages, cursor: older || !loadedOlder ? page.cursor : state.cursor, ready: true, error: '' });
        } catch (error) { if (generation === sessionRevision) publish({ error: mutationProblem(error).message, olderError: older }); }
        finally { if (generation === sessionRevision) publish({ olderLoading: false }); }
    }
    function acquire() {
        if (!active || !started || !foreground || release || !core.capabilities().stream) return;
        try {
            release = core.watchConversation(id, {
                onSnapshot(snapshot) {
                    // The real pool replays a connecting placeholder before any host transcript.
                    if (!snapshot.established && !snapshot.messages.length && snapshot.cursor === undefined && snapshot.eventSeq === undefined) return;
                    changeSession(snapshot.sessionId);
                    liveRevision++;
                    for (const message of snapshot.messages) liveAt.set(message.id, liveRevision);
                    publish({ messages: liveOver(state.messages, snapshot.messages), ...(loadedOlder || snapshot.cursor === undefined ? {} : { cursor: snapshot.cursor }), ready: true, error: '' });
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
            void core.cachedHistory(id).then(messages => { if (!state.ready && messages.length) publish({ messages, ready: true }); }).catch(error => publish({ error: mutationProblem(error).message }));
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
