import type { Attachment, Conversation } from '@ds-bot/mobile-sdk';
import { mobileActionAllowed, mobileCancelAllowed } from '../logic/mobile-access.ts';
import { conversationStreams } from '../logic/conversation-streams.ts';
import type { GroupRound } from '../logic/group-work.ts';
import type { OutboxItem } from '../outbox/outbox.ts';
import { DsCoreError, type DsBotPatch, type DsCore, type DsCoreOptions, type DsConversationListener, type DsCreateBot, type DsCreateGroup, type DsGroupPatch, type DsHistory, type DsMessage, type DsModelOptions, type DsPreferences, type DsSendState, type DsSnapshot, type DsWriteResult } from './contracts.ts';
import { dsId, parseDsId, type DsKind } from './identity.ts';
import { projectBot, projectGroup, projectSnapshot, projectTranscript, projectWork } from './projection.ts';
/** Deliberate supported subset of plugin/bridge/src/actions.mjs. No generic upstream RPC passthrough. */
export const DS_ACTIONS = ['efforts', 'update-bot', 'create-bot', 'delete-bot', 'duplicate-bot', 'set-main', 'create-room', 'update-room', 'delete-room', 'set-flags', 'set-prefs', 'stop-member-work', 'room-progress'] as const;
export const DS_UNSUPPORTED = ['provider-configuration', 'accounts', 'marketplace', 'workflows', 'remote-terminal', 'browser', 'workspaces', 'agent-management', 'message-edit', 'message-delete', 'reactions'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function fields(value: object, allowed: readonly string[]): Record<string, unknown> {
    if (!value || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
        throw new DsCoreError('INVALID_INPUT', 'Unsupported command fields.');
    return Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined));
}
function changes(value: Record<string, unknown>, current: object): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([key, value]) => !same(value, (current as Record<string, unknown>)[key])));
}
const botFields = ['name', 'role', 'instructions', 'color', 'avatar', 'model', 'effort'];
export function createDsCore(options: DsCoreOptions): DsCore {
    const { client, serverId, outbox } = options;
    let disposed = false;
    const accepted = new Set<string>();
    const listeners = new Set<() => void>();
    const streamReleases = new Set<() => void>();
    function current(): DsSnapshot {
        const snapshot = options.getSnapshot();
        if (disposed || !options.isCurrent() || !snapshot || snapshot.serverId !== serverId || snapshot.client !== client)
            throw new DsCoreError('STALE_HOST', 'This view belongs to a previous host connection.');
        return snapshot;
    }
    function live(write = false): DsSnapshot {
        const snapshot = current();
        if (!options.isOnline())
            throw new DsCoreError('OFFLINE', 'Reconnect to the computer to continue.');
        if (snapshot.source !== 'live')
            throw new DsCoreError('STALE_SNAPSHOT', 'Refresh this connection before using host capabilities.');
        if (write && snapshot.team.readOnly)
            throw new DsCoreError('READ_ONLY', snapshot.team.readOnly);
        return snapshot;
    }
    function guard(action: typeof DS_ACTIONS[number], write = true) {
        const snapshot = live(write);
        if (!mobileActionAllowed(snapshot.team.mobileCapabilities, action))
            throw new DsCoreError('UNSUPPORTED', 'This action is not available through the DS Bridge.');
        return snapshot;
    }
    function source(id: string, kind: DsKind): string {
        try {
            const parsed = parseDsId(id);
            if (parsed.serverId === serverId && parsed.kind === kind)
                return parsed.sourceId;
        }
        catch { }
        throw new DsCoreError('INVALID_ID', 'Select an item of the expected kind on this computer.');
    }
    const bot = (id: string, snapshot = current()) => {
        const found = snapshot.team.bots.find(b => b.id === source(id, 'bot'));
        if (!found)
            throw new DsCoreError('NOT_FOUND', 'This Bot is no longer on the visible team.');
        return found;
    };
    const group = (id: string, snapshot = current()) => {
        const found = snapshot.team.rooms.find(r => r.id === source(id, 'group'));
        if (!found)
            throw new DsCoreError('NOT_FOUND', 'This group is no longer on the visible team.');
        return found;
    };
    function conversation(id: string): Conversation {
        const snapshot = current();
        const found = snapshot.conversations.find(c => c.id === source(id, 'conversation'));
        if (!found || !['bot', 'room', 'agent'].includes(found.kind))
            throw new DsCoreError('NOT_FOUND', 'This conversation is no longer visible.');
        if (found.kind === 'agent' && (snapshot.source !== 'live' || !snapshot.team.agentAccess))
            throw new DsCoreError('UNSUPPORTED', 'The computer owner has not granted DSH Agent access.');
        return found;
    }
    function capabilities() {
        const snapshot = current(), trusted = snapshot.source === 'live' && options.isOnline();
        const writable = trusted && !snapshot.team.readOnly;
        const actions = trusted ? DS_ACTIONS.filter(a => mobileActionAllowed(snapshot.team.mobileCapabilities, a) && (writable || ['efforts', 'room-progress'].includes(a))) : [];
        return { actions, send: !!outbox && writable && snapshot.team.mobileCapabilities?.send === true, history: trusted && snapshot.team.mobileCapabilities?.history === true, stream: trusted && snapshot.team.mobileCapabilities?.stream === true, cancel: writable && mobileCancelAllowed(snapshot.team.mobileCapabilities), modelSelection: actions.includes('efforts') && actions.includes('update-bot'), agents: trusted && snapshot.team.agentAccess === true, providerConfiguration: false as const, accounts: false as const, unsupported: DS_UNSUPPORTED };
    }
    function textGrant(kind: 'send' | 'history' | 'stream') {
        const snapshot = live(kind === 'send');
        if (snapshot.team.mobileCapabilities?.[kind] !== true)
            throw new DsCoreError('UNSUPPORTED', 'This computer has not granted access to this conversation operation.');
        return snapshot;
    }
    function validateSnapshot(snapshot: DsSnapshot | undefined): DsSnapshot {
        current();
        if (!snapshot || snapshot.source !== 'live')
            throw new DsCoreError('STALE_SNAPSHOT', 'The computer did not return a fresh snapshot.');
        if (snapshot.serverId !== serverId || snapshot.client !== client)
            throw new DsCoreError('STALE_HOST', 'The refreshed snapshot belongs to another connection.');
        return snapshot;
    }
    async function refresh(): Promise<DsSnapshot> {
        current();
        return validateSnapshot(await options.refresh({ fresh: true }));
    }
    async function write<T>(action: typeof DS_ACTIONS[number], payload: Record<string, unknown>, readback: (snapshot: DsSnapshot, ack: Record<string, unknown>) => T): Promise<DsWriteResult<T>> {
        guard(action);
        return mutation(() => client.action(action, payload), readback);
    }
    async function mutation<T>(perform: () => Promise<Record<string, unknown>>, readback: (snapshot: DsSnapshot, ack: Record<string, unknown>) => T): Promise<DsWriteResult<T>> {
        let ack: Record<string, unknown>;
        try {
            ack = await perform();
        }
        catch (error) {
            current();
            if (typeof error === 'object' && error !== null && 'status' in error && Number(error.status) >= 400 && Number(error.status) < 500)
                throw error;
            throw new DsCoreError('MUTATION_UNCONFIRMED', 'The computer may have applied this change. Refresh before retrying.', { mutation: 'unknown', cause: error });
        }
        current();
        try {
            const snapshot = await refresh();
            return { status: 'confirmed', value: readback(snapshot, ack), acknowledgement: ack };
        }
        catch (error) {
            if (error instanceof DsCoreError && error.code === 'STALE_HOST')
                throw error;
            throw new DsCoreError('READBACK_FAILED', 'The computer acknowledged the change, but its updated state could not be read. Refresh before retrying.', { acknowledgement: ack, mutation: 'acknowledged', cause: error });
        }
    }
    async function modelOptions(ref: string): Promise<DsModelOptions> {
        const snapshot = guard('efforts', false), model = snapshot.team.models.find(m => m.ref === ref);
        if (!model)
            throw new DsCoreError('INVALID_MODEL', 'Select a model discovered on this computer.');
        const result = await client.action<{
            efforts: DsModelOptions['efforts'];
            default?: string;
        }>('efforts', { ref });
        const latest = guard('efforts', false);
        if (!latest.team.models.some(m => m.ref === ref))
            throw new DsCoreError('INVALID_MODEL', 'This model is no longer offered by the computer.');
        if (!Array.isArray(result.efforts) || result.efforts.some(e => typeof e.id !== 'string' || typeof e.name !== 'string'))
            throw new DsCoreError('INVALID_EFFORT', 'The computer did not return valid reasoning choices.');
        return { model, efforts: result.efforts, defaultEffort: result.default };
    }
    async function validateModel(patch: Record<string, unknown>, original?: string) {
        const snapshot = live(true), ref = patch.model === null ? snapshot.team.defaultModel : typeof patch.model === 'string' ? patch.model : original ?? snapshot.team.defaultModel;
        if (patch.model !== undefined && patch.model !== null && (typeof patch.model !== 'string' || !snapshot.team.models.some(m => m.ref === patch.model)))
            throw new DsCoreError('INVALID_MODEL', 'Select a model discovered on this computer.');
        if (patch.effort !== undefined && patch.effort !== null) {
            if (!ref)
                throw new DsCoreError('INVALID_MODEL', 'The computer has no default model.');
            const choices = await modelOptions(ref);
            if (!choices.efforts.some(e => e.id === patch.effort))
                throw new DsCoreError('INVALID_EFFORT', 'Select an actual reasoning choice offered by this model.');
        }
        const latest = live(true);
        const latestRef = patch.model === null ? latest.team.defaultModel : typeof patch.model === 'string' ? patch.model : original ?? latest.team.defaultModel;
        if (patch.effort != null && latestRef !== ref)
            throw new DsCoreError('STALE_SNAPSHOT', 'The Bot model or reasoning choice changed while options were loading. Refresh the selection.');
        if (typeof patch.model === 'string' && !latest.team.models.some(m => m.ref === patch.model))
            throw new DsCoreError('INVALID_MODEL', 'This model is no longer offered by the computer.');
    }
    const sendState = (item: OutboxItem): DsSendState => ({ requestId: item.requestId, conversationId: dsId(serverId, 'conversation', item.conversationId), state: item.state === 'sent' ? 'accepted' : item.state, text: item.text, attachments: item.attachments, error: item.error, persistence: item.persistence });
    const stopOutbox = outbox?.subscribe(() => {
        try {
            current();
        }
        catch {
            return;
        }
        let newlyAccepted = false;
        for (const item of outbox.list())
            if (item.state === 'sent' && !accepted.has(item.requestId)) {
                accepted.add(item.requestId);
                newlyAccepted = true;
            }
        if (newlyAccepted)
            void refresh().catch(() => { });
        for (const listener of listeners) {
            try { listener(); } catch { /* A detached UI must not interrupt durable delivery. */ }
        }
    });
    function groupPayload(input: DsGroupPatch | DsCreateGroup, creating = false) {
        const payload = fields(input, creating ? ['name', 'members', 'admin', 'greet'] : ['name', 'notice', 'mode', 'members', 'admin']);
        if (input.members)
            payload.members = input.members.map(id => bot(id).id);
        if (input.admin)
            payload.admin = bot(input.admin).id;
        return payload;
    }
    function requireOutbox() { if (!outbox)
        throw new DsCoreError('UNSUPPORTED', 'The session has no durable outbox.'); return outbox; }
    return {
        read: () => projectSnapshot(current(), capabilities()),
        capabilities,
        modelOptions,
        refresh,
        async updateBot(id: string, input: DsBotPatch) {
            const snapshot = guard('update-bot'), original = bot(id, snapshot);
            const patch = changes(fields(input, botFields), original);
            if (!Object.keys(patch).length)
                return { status: 'unchanged' as const, value: projectBot(serverId, original, snapshot.conversations), acknowledgement: null };
            const originalRef = original.model ?? snapshot.team.defaultModel;
            const originalEffort = original.effort;
            // Changing the model revalidates the retained effort, even when
            // changed-field filtering omitted that explicitly selected value.
            const selection = patch.model !== undefined
                ? { ...patch, effort: input.effort !== undefined ? input.effort : original.effort }
                : patch;
            await validateModel(selection, original.model);
            const latestBot = bot(id);
            if (patch.model !== undefined && patch.effort === undefined && latestBot.effort !== originalEffort)
                throw new DsCoreError('STALE_SNAPSHOT', 'The Bot model or reasoning choice changed while options were loading. Refresh the selection.');
            if (patch.model === undefined && patch.effort != null && (latestBot.model ?? current().team.defaultModel) !== originalRef)
                throw new DsCoreError('STALE_SNAPSHOT', 'The Bot model changed while its reasoning choices were loading. Refresh the selection.');
            return write('update-bot', { id: original.id, ...patch }, s => projectBot(serverId, bot(id, s), s.conversations));
        },
        async createBot(input: DsCreateBot) {
            guard('create-bot');
            const payload = fields(input, botFields);
            await validateModel(payload);
            return write('create-bot', payload, (s, ack) => {
                if (typeof ack.id !== 'string')
                    throw new Error('Missing created Bot ID.');
                return projectBot(serverId, bot(dsId(serverId, 'bot', ack.id), s), s.conversations);
            });
        },
        async deleteBot(id: string) {
            const original = bot(id);
            return write('delete-bot', { id: original.id }, s => { if (s.team.bots.some(b => b.id === original.id))
                throw new Error('Bot still present.'); return { id, deleted: true as const }; });
        },
        async duplicateBot(id: string) {
            const original = bot(id);
            return write('duplicate-bot', { id: original.id }, (s, ack) => { if (typeof ack.id !== 'string')
                throw new Error('Missing duplicated Bot ID.'); return projectBot(serverId, bot(dsId(serverId, 'bot', ack.id), s), s.conversations); });
        },
        async setMainBot(id: string, input: {
            main?: boolean;
            primary?: boolean;
            replace?: string;
        }) {
            const original = bot(id), payload = fields(input, ['main', 'primary', 'replace']);
            if (input.replace)
                payload.replace = bot(input.replace).id;
            return write('set-main', { id: original.id, ...payload }, s => ({ mainBotId: s.team.mainBotId ? dsId(serverId, 'bot', s.team.mainBotId) : null, mainBotIds: (s.team.mainBotIds ?? []).map(id => dsId(serverId, 'bot', id)) }));
        },
        async createGroup(input: DsCreateGroup) {
            guard('create-room');
            return write('create-room', groupPayload(input, true), (s, ack) => { if (typeof ack.id !== 'string')
                throw new Error('Missing created group ID.'); return projectGroup(serverId, group(dsId(serverId, 'group', ack.id), s), s.conversations); });
        },
        async updateGroup(id: string, input: DsGroupPatch) {
            const snapshot = guard('update-room'), original = group(id, snapshot), payload = changes(groupPayload(input), original);
            if (!Object.keys(payload).length)
                return { status: 'unchanged' as const, value: projectGroup(serverId, original, snapshot.conversations), acknowledgement: null };
            return write('update-room', { id: original.id, ...payload }, s => projectGroup(serverId, group(id, s), s.conversations));
        },
        async deleteGroup(id: string) {
            const original = group(id);
            return write('delete-room', { id: original.id }, s => { if (s.team.rooms.some(g => g.id === original.id))
                throw new Error('Group still present.'); return { id, deleted: true as const }; });
        },
        async setFlags(id: string, input: {
            pinned?: boolean;
            hidden?: boolean;
        }) {
            const original = conversation(id);
            guard('set-flags');
            const payload = changes(fields(input, ['pinned', 'hidden']), original);
            const read = (s: DsSnapshot) => { const value = s.conversations.find(c => c.id === original.id); if (!value)
                throw new Error('Conversation is no longer visible.'); return value; };
            if (!Object.keys(payload).length)
                return { status: 'unchanged' as const, value: original, acknowledgement: null };
            return write('set-flags', { id: original.id, ...payload }, read);
        },
        async setPreferences(input: DsPreferences) {
            const snapshot = guard('set-prefs'), payload = changes(fields(input, ['theme', 'accent', 'motion']), snapshot.team.prefs ?? {});
            if (!Object.keys(payload).length)
                return { status: 'unchanged' as const, value: snapshot.team.prefs ?? {}, acknowledgement: null };
            return write('set-prefs', payload, s => s.team.prefs ?? {});
        },
        async history(id: string, options?: {
            cursor?: string | null;
            limit?: number;
        }): Promise<DsHistory> {
            textGrant('history');
            const target = conversation(id);
            const page = await client.messages(target.id, options);
            textGrant('history');
            conversation(id);
            await outbox?.settle(target.id, page.messages);
            conversation(id);
            return { messages: projectTranscript(serverId, target, page.messages), cursor: page.cursor, sessionId: dsId(serverId, 'session', page.sessionId) };
        },
        async cachedHistory(id: string): Promise<DsMessage[]> {
            const target = conversation(id), messages = await client.getCachedMessages(target.id);
            conversation(id);
            return projectTranscript(serverId, target, messages);
        },
        async send(id: string, input: {
            text: string;
            attachments?: Attachment[];
        }): Promise<DsSendState | null> {
            const snapshot = textGrant('send');
            const target = conversation(id), queue = requireOutbox();
            for (const attachment of input.attachments ?? []) {
                const feature = attachment.type === 'image' ? 'images' : 'files';
                if (snapshot.team.mobileCapabilities?.[feature] !== true)
                    throw new DsCoreError('UNSUPPORTED', 'This computer has not granted access to this attachment type.');
            }
            // Load first, then recheck host liveness before enqueue's first durable side effect.
            await queue.load();
            textGrant('send');
            conversation(id);
            const item = await queue.enqueue({ conversationId: target.id, ...input });
            current();
            return item ? sendState(item) : null;
        },
        pending(id: string): DsSendState[] { const target = conversation(id); return outbox?.list(target.id).map(sendState) ?? []; },
        async retrySend(requestId: string) {
            textGrant('send');
            const queue = requireOutbox(), item = queue.list().find(i => i.requestId === requestId);
            if (!item)
                throw new DsCoreError('NOT_FOUND', 'This pending send is no longer available.');
            conversation(dsId(serverId, 'conversation', item.conversationId));
            await queue.retry(requestId);
            current();
        },
        async discardSend(requestId: string) { current(); await requireOutbox().discard(requestId); current(); },
        async cancel(id: string) {
            live(true);
            if (!capabilities().cancel)
                throw new DsCoreError('UNSUPPORTED', 'This computer does not offer cancellation.');
            const target = conversation(id);
            return (await mutation(() => client.cancel(target.id), (_snapshot, acknowledgement) => acknowledgement)).value;
        },
        async groupProgress(id: string): Promise<GroupRound[]> {
            guard('room-progress', false);
            const original = group(id);
            const rounds = await client.action<GroupRound[]>('room-progress', { roomId: original.id });
            guard('room-progress', false);
            group(id);
            return rounds;
        },
        async stopGroupMember(groupId: string, botId: string) {
            const room = group(groupId), member = bot(botId);
            if (!room.members.includes(member.id))
                throw new DsCoreError('INVALID_ID', 'This Bot is not a member of this group.');
            return write('stop-member-work', { roomId: room.id, botId: member.id }, s => projectWork(serverId, s.team)[groupId]);
        },
        watchConversation(id: string, listener: DsConversationListener): () => void {
            textGrant('stream');
            const target = conversation(id);
            let stopped = false;
            const valid = () => { try {
                textGrant('stream');
                conversation(id);
                return !stopped;
            }
            catch {
                return false;
            } };
            const release = conversationStreams.acquire(client, serverId, target.id, {
                onSnapshot(snapshot) {
                    if (!valid()) return;
                    void outbox?.settle(target.id, snapshot.messages).catch(error => {
                        if (valid()) listener.onError?.(error);
                    });
                    listener.onSnapshot({ ...snapshot, messages: projectTranscript(serverId, target, snapshot.messages) });
                },
                onStatus(status) { if (valid())
                    listener.onStatus?.(status); },
                onError(error) { if (valid())
                    listener.onError?.(error); },
            });
            const stop = () => { if (stopped)
                return; stopped = true; release.release(); streamReleases.delete(stop); };
            streamReleases.add(stop);
            return stop;
        },
        subscribe(listener: () => void) { current(); listeners.add(listener); return () => { listeners.delete(listener); }; },
        unsupported(feature: string): never { throw new DsCoreError('UNSUPPORTED', 'This feature is not available through the DS Bridge.'); },
        dispose() { disposed = true; stopOutbox?.(); for (const release of streamReleases)
            release(); listeners.clear(); },
    };
}
export type { DsCore } from './contracts.ts';
