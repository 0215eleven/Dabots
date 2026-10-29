import type { Cache } from '@ds-bot/mobile-sdk';
import type { DsCore } from './contracts.ts';
import { parseDsId } from './identity.ts';
// Serialize the original cache key across route lifetimes, including a slow old write.
const writes = new WeakMap<object, Map<string, Promise<void>>>();
export function createDraft(core: DsCore, id: string, cache: Pick<Cache, 'getDraft' | 'setDraft'>) {
    const {serverId, sourceId, kind} = parseDsId(id);
    if (kind !== 'conversation' || core.read().serverId !== serverId) throw Error('Invalid draft owner.');
    let active = true, revision = 0, text = '';
    const listeners = new Set<() => void>();
    let queue = writes.get(cache);
    if (!queue) { queue = new Map(); writes.set(cache, queue); }
    const key = JSON.stringify([serverId, sourceId]), owned = queue;
    const publish = () => { if (active) for (const listener of listeners) listener(); };
    function set(value: string) {
        if (!active || !core.capabilities().editDraft) return;
        revision++; text = value; publish();
        const pending = (owned.get(key) ?? Promise.resolve()).catch(() => {}).then(() => cache.setDraft(serverId, sourceId, value));
        owned.set(key, pending);
        void pending.catch(() => {}).finally(() => { if (owned.get(key) === pending) owned.delete(key); });
    }
    return {
        get: () => text,
        subscribe(listener: () => void) { listeners.add(listener); return () => {listeners.delete(listener);}; },
        async load() {
            const version = revision;
            await owned.get(key)?.catch(() => {});
            const saved = await cache.getDraft(serverId, sourceId);
            if (active && version === revision && core.capabilities().editDraft) {text = saved; publish();}
        },
        set,
        capture: () => ({revision, text}),
        // The caller invokes this only after durable enqueue; newer typing must survive it.
        sent(at: {revision: number; text: string}) { if (active && at.revision === revision && at.text === text) set(''); },
        dispose() {active = false; listeners.clear();},
    };
}
