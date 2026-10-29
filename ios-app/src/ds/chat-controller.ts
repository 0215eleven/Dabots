import type { DsCore, DsMessage } from './contracts.ts';
import { mutationProblem } from './screen-binding.ts';
export interface ChatScreenState {
    messages: DsMessage[];
    ready: boolean;
    error: string;
    cursor: string | null;
    olderLoading: boolean;
    olderError: boolean;
}
/** The actual screen's asynchronous reader: each instance belongs to one client and conversation. */
export function createChatBinding(core: DsCore, id: string) {
    let state: ChatScreenState = { messages: [], ready: false, error: '', cursor: null, olderLoading: false, olderError: false };
    let active = true, started = false, revision = 0;
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const publish = (patch: Partial<ChatScreenState>) => { if (!active)
        return; state = { ...state, ...patch }; for (const listener of listeners)
        listener(); };
    async function load(older = false) { if (!active || older && state.olderLoading)
        return; const version = revision; const cursor = state.cursor; if (older)
        publish({ olderLoading: true, olderError: false }); try {
        const page = await core.history(id, older ? { cursor } : {});
        if (!active)
            return;
        if (older)
            publish({ messages: [...page.messages, ...state.messages.filter(m => !page.messages.some(p => p.id === m.id))], cursor: page.cursor, ready: true, error: '' });
        else if (version === revision) {
            revision++;
            publish({ messages: page.messages, cursor: page.cursor, ready: true, error: '' });
        }
    }
    catch (error) {
        publish({ error: mutationProblem(error).message, olderError: older });
    }
    finally {
        publish({ olderLoading: false });
    } }
    return { get: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, setError: (error: string) => publish({ error }), load,
        start() { if (started || !active)
            return; started = true; void core.cachedHistory(id).then(messages => { if (!state.ready && messages.length)
            publish({ messages, ready: true }); }).catch(error => publish({ error: mutationProblem(error).message })); const caps = core.capabilities(); if (caps.history)
            void load(); if (caps.stream) {
            try {
                release = core.watchConversation(id, { onSnapshot: snapshot => { revision++; publish({ messages: snapshot.messages, cursor: snapshot.cursor ?? null, ready: true, error: '' }); }, onError: error => publish({ error: mutationProblem(error).message }) });
            }
            catch (error) {
                publish({ error: mutationProblem(error).message });
            }
        } },
        dispose() { active = false; release?.(); listeners.clear(); },
    };
}
