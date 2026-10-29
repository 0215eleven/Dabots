import type { Conversation, Message } from '@ds-bot/mobile-sdk';
import type { TeamState } from '../types.ts';
import { groupWorkMembers, ownBotWork, workDescription } from '../logic/group-work.ts';
import type { DsBotView, DsCapabilities, DsConversationView, DsGroupView, DsMessage, DsSnapshot, DsView, DsWorkView } from './contracts.ts';
import { dsId } from './identity.ts';
/** DS Bridge currently uses raw IDs; an explicit owner ID is honored if a newer host supplies it. */
export function ownerSourceId(conversation: Conversation): string | null {
    const key = conversation.kind === 'bot' ? 'botId' : conversation.kind === 'room' ? 'roomId' : 'agentId';
    return typeof conversation[key] === 'string' ? conversation[key] : conversation.kind === 'agent' ? null : conversation.id;
}
export function projectBot(serverId: string, bot: TeamState['bots'][number], conversations: Conversation[]): DsBotView {
    const { id, sessionId: _sessionId, model, effort, ...rest } = bot;
    const chat = conversations.find(c => c.kind === 'bot' && ownerSourceId(c) === id);
    return { ...rest, id: dsId(serverId, 'bot', id), sourceId: id, serverId, modelRef: model ?? null, effortId: effort ?? null,
        conversationId: chat ? dsId(serverId, 'conversation', chat.id) : null, sessionId: chat ? dsId(serverId, 'session', chat.sessionId) : null };
}
export function projectGroup(serverId: string, room: TeamState['rooms'][number], conversations: Conversation[]): DsGroupView {
    const chat = conversations.find(c => c.kind === 'room' && ownerSourceId(c) === room.id);
    return { ...room, id: dsId(serverId, 'group', room.id), sourceId: room.id, serverId, members: room.members.map(id => dsId(serverId, 'bot', id)), admin: room.admin ? dsId(serverId, 'bot', room.admin) : null,
        conversationId: chat ? dsId(serverId, 'conversation', chat.id) : null, sessionId: chat ? dsId(serverId, 'session', chat.sessionId) : null };
}
export function projectWork(serverId: string, team: TeamState): Record<string, DsWorkView> {
    const result: Record<string, DsWorkView> = {};
    for (const bot of team.bots) {
        const work = ownBotWork(bot.id, team);
        const waiting = team.work?.approvals.some(a => a.botId === bot.id && !a.roomId) || (bot.waiting && !team.work?.bots[bot.id]?.roomId);
        result[dsId(serverId, 'bot', bot.id)] = { phase: waiting ? 'waiting' : work?.said ? 'responding' : work ? 'working' : 'idle', detail: workDescription(work) || null };
    }
    for (const room of team.rooms) {
        const members = groupWorkMembers(room, team).map(({ bot, work, waiting }) => ({ botId: dsId(serverId, 'bot', bot.id), phase: (waiting ? 'waiting' : work?.said ? 'responding' : 'working') as DsWorkView['phase'], detail: workDescription(work) || null }));
        result[dsId(serverId, 'group', room.id)] = { phase: members.some(m => m.phase === 'waiting') ? 'waiting' : members.length ? 'working' : 'idle', detail: null, members };
    }
    return result;
}
export function projectTranscript(serverId: string, conversation: Conversation, messages: readonly Message[]): DsMessage[] {
    return messages.map(message => {
        const speaker = typeof message.author === 'object' && typeof message.author?.id === 'string' ? message.author.id : conversation.kind === 'bot' ? ownerSourceId(conversation) : null;
        const author = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : message.role === 'agent' ? 'agent' : 'system';
        const date = new Date(message.createdAt);
        return { id: dsId(serverId, 'message', JSON.stringify([conversation.id, message.sessionId, message.id])), author, text: message.text, createdAt: Number.isNaN(date.getTime()) ? String(message.createdAt) : date.toISOString(),
            status: message.delivery === 'rejected' ? 'failed' : message.interrupted ? 'interrupted' : message.pending ? 'streaming' : 'completed',
            ...(speaker && author !== 'user' ? { senderAgentId: dsId(serverId, conversation.kind === 'agent' ? 'agent' : 'bot', speaker) } : {}),
            ...(message.tool ? { itemType: 'tool' } : message.systemEvent ? { itemType: 'system' } : {}),
            ds: { source: message, conversationId: dsId(serverId, 'conversation', conversation.id), sessionId: dsId(serverId, 'session', message.sessionId), reasoning: message.reasoning, tool: message.tool, delivery: message.delivery, author: message.author, attachments: message.attachments } };
    });
}
export function projectSnapshot(snapshot: DsSnapshot, capabilities: DsCapabilities): DsView {
    const { serverId, team } = snapshot;
    const conversations: DsConversationView[] = snapshot.conversations.flatMap(source => {
        if (!['bot', 'room', 'agent'].includes(source.kind) || (source.kind === 'agent' && !capabilities.agents))
            return [];
        const kind = source.kind === 'room' ? 'group' : source.kind as 'bot' | 'agent';
        const owner = ownerSourceId(source);
        return [{ id: dsId(serverId, 'conversation', source.id), sourceId: source.id, serverId, sessionId: dsId(serverId, 'session', source.sessionId), kind, name: source.name, ownerId: owner ? dsId(serverId, kind, owner) : null, source }];
    });
    return { serverId, source: snapshot.source, bots: team.bots.map(b => projectBot(serverId, b, snapshot.conversations)), groups: team.rooms.map(r => projectGroup(serverId, r, snapshot.conversations)), conversations: conversations.filter(c => c.kind !== 'agent'), agents: conversations.filter(c => c.kind === 'agent'), models: team.models, preferences: team.prefs ?? {}, work: projectWork(serverId, team), capabilities, readOnly: team.readOnly ?? null };
}
