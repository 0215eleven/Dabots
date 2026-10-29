import type {DsCore, DsHostQueue} from './contracts.ts';
export interface QueueState {hostQueue: DsHostQueue | null; queueStatus: 'unavailable' | 'loading' | 'ready'}
/** One visible conversation; read-only public Bridge queue, never the local outbox. */
export function createQueueObserver(core: DsCore, id: string, publish: (state: QueueState) => void, clock = {
    now: () => Date.now(), set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
}) {
    let active = true, started = false, foreground = true, session: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined, last = -Infinity;
    let observed = false;
    const unavailable = () => {observed = false; publish({hostQueue: null, queueStatus: 'unavailable'});};
    function clear() { if (timer !== undefined) clock.clear(timer); timer = undefined; request?.abort(); request = undefined; }
    function schedule(delay: number) {
        if (!active || !started || !foreground || request) return;
        if (timer !== undefined) clock.clear(timer);
        timer = clock.set(() => {timer = undefined; void read();}, delay);
    }
    async function read() {
        if (!active || !foreground || request) return;
        try { if (!core.capabilities().actions.includes('queue')) {unavailable(); schedule(8000); return;} }
        catch {unavailable(); return;}
        const pending = new AbortController(), target = session;
        request = pending; last = clock.now();
        if (!observed) publish({hostQueue: null, queueStatus: 'loading'});
        try {
            const queue = await core.queue(id, pending.signal);
            if (!active || !foreground || pending !== request || pending.signal.aborted) return;
            if (target && queue.sessionId !== target) {unavailable(); return;}
            session = queue.sessionId; observed = true;
            publish({hostQueue: queue, queueStatus: 'ready'});
        } catch {if (active && foreground && pending === request) unavailable();}
        finally {if (pending === request) {request = undefined; schedule(8000);}}
    }
    return {
        start() {if (started) return; started = true; schedule(0);},
        event(next?: string) {
            if (!active) return;
            if (next && next !== session) {session = next; clear(); unavailable();}
            schedule(Math.max(0, 1000 - (clock.now() - last)));
        },
        setForeground(value: boolean) {foreground = value; if (!value) {clear(); unavailable();} else schedule(0);},
        dispose() {active = false; clear();},
    };
}
