import { DsCoreError, type DsCore, type DsView, type DsCreateBot, type DsBotPatch, type DsCreateGroup, type DsGroupPatch, type DsPreferences } from './contracts.ts';
import { dsId } from './identity.ts';
export function createScreenCommands(core: DsCore, serverId: string) {
    const current = () => { if (core.read().serverId !== serverId)
        throw new DsCoreError('STALE_HOST', 'This form belongs to another computer.'); };
    return {
        createBot(input: DsCreateBot) { current(); return core.createBot(input); },
        updateBot(id: string, input: DsBotPatch) { current(); return core.updateBot(id, input); },
        createGroup(input: DsCreateGroup) { current(); return core.createGroup(input); },
        updateGroup(id: string, input: DsGroupPatch) { current(); return core.updateGroup(id, input); },
        setPreferences(input: DsPreferences) { current(); return core.setPreferences(input); },
        modelOptions(ref: string) { current(); return core.modelOptions(ref); },
    };
}
export function resolveScreenRoute(view: DsView, route: string, id?: string): {
    kind: 'bot' | 'group' | 'agent' | 'unavailable';
    id?: string;
} {
    if (!id || !['chat', 'channel', 'agent-info', 'channel-info'].includes(route))
        return { kind: 'unavailable' };
    const bot = view.bots.find(x => x.id === id || x.conversationId === id);
    const group = view.groups.find(x => x.id === id || x.conversationId === id);
    if (bot)
        return { kind: 'bot', id: bot.id };
    if (group)
        return { kind: 'group', id: group.id };
    const conversation = [...view.conversations, ...(view.agents ?? [])].find(x => x.id === id || (!id.startsWith('ds:') && x.sourceId === id));
    if (!conversation)
        return { kind: 'unavailable' };
    if (conversation.kind === 'agent')
        return { kind: 'agent', id: conversation.id };
    return conversation.ownerId ? { kind: conversation.kind, id: conversation.ownerId } : { kind: 'unavailable' };
}
export function mutationProblem(error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'READBACK_FAILED')
        return { retry: false, message: 'The computer acknowledged the change, but its current state could not be read. Refresh and check it before making another change.' };
    if (code === 'MUTATION_UNCONFIRMED')
        return { retry: false, message: 'The reply was lost. The change may already exist on the computer. Refresh and check it before making another change.' };
    if (code === 'PERSISTENCE_UNCONFIRMED')
        return { retry: false, message: 'Local storage could not be verified. The existing pending message keeps its request ID; resolve that item before sending again.' };
    return { retry: true, message: error instanceof Error ? error.message : String(error) };
}
/** One send attempt. Persistence ambiguity refers to the original pending intent, never a new send. */
export async function sendScreenMessage(core: DsCore, conversationId: string, text: string) {
    try {
        return { queued: await core.send(conversationId, { text }), existing: null, problem: null };
    }
    catch (error) {
        const problem = mutationProblem(error);
        const requestId = error && typeof error === 'object' && 'code' in error && error.code === 'PERSISTENCE_UNCONFIRMED' && 'requestId' in error ? error.requestId : null;
        const existing = typeof requestId === 'string' ? core.pending(conversationId).find(item => item.requestId === requestId) ?? null : null;
        return { queued: null, existing, problem };
    }
}
