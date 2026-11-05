import type { DsMessage } from './contracts.ts';
import type { ChatBubbleMessage } from '../../openbot/mobile/src/features/chat/model/chat-messages';
import {messageAttachments} from './attachment-preview.ts';
/** Preserve original host message IDs, author identities and all useful DS transcript details. */
export function screenMessages(messages: readonly DsMessage[], text: (key: string) => string = key => key, options:{previews?:boolean;epoch?:string}={}): ChatBubbleMessage[] {
    return messages.map(message => {
        const ds = message.ds;
        const details = [message.text, ds.delivery ? `${text('Delivery')}: ${text(ds.delivery)}` : null, ds.source.systemEvent ? `${text('System')}: ${JSON.stringify(ds.source.systemEvent)}` : null, ds.reasoning ? `${text('Reasoning')}\n${ds.reasoning}` : null, ds.tool ? `${text('Tool')}\n${JSON.stringify(ds.tool, null, 2)}` : null].filter(Boolean).join('\n\n');
        return { id: message.id, kind: 'message', author: message.author === 'user' ? 'user' : 'agent', body: details, attachments:messageAttachments(message,options), streaming: message.status === 'streaming', status: message.status, createdAt: message.createdAt, ...(ds.author ? { speaker: { kind: message.author === 'user' ? 'member' : 'agent', id: message.senderAgentId ?? message.senderMember?.id ?? '', name: typeof ds.author === 'string' ? ds.author : String(ds.author.name ?? ds.author.id ?? '') } } : {}) };
    });
}
