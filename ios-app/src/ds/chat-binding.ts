import type { DsMessage } from './contracts.ts';
import type { ChatBubbleMessage } from '../../openbot/mobile/src/features/chat/model/chat-messages';
/** Preserve original host message IDs, author identities and all useful DS transcript details. */
export function screenMessages(messages: readonly DsMessage[]): ChatBubbleMessage[] {
    return messages.map(message => {
        const ds = message.ds;
        const details = [message.text, ds.delivery ? `Delivery: ${ds.delivery}` : null, ds.source.systemEvent ? `System: ${JSON.stringify(ds.source.systemEvent)}` : null, ds.reasoning ? `Reasoning\n${ds.reasoning}` : null, ds.tool ? `Tool\n${JSON.stringify(ds.tool, null, 2)}` : null, ds.attachments?.length ? `Attachments\n${ds.attachments.map(a => JSON.stringify(a)).join('\n')}` : null].filter(Boolean).join('\n\n');
        return { id: message.id, kind: 'message', author: message.author === 'user' ? 'user' : 'agent', body: details, streaming: message.status === 'streaming', status: message.status, createdAt: message.createdAt, ...(ds.author ? { speaker: { kind: message.author === 'user' ? 'member' : 'agent', id: message.senderAgentId ?? message.senderMember?.id ?? '', name: typeof ds.author === 'string' ? ds.author : String(ds.author.name ?? ds.author.id ?? '') } } : {}) };
    });
}
