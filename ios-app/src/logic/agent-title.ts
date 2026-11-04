import type {Conversation,MobileClient} from '@ds-bot/mobile-sdk';

export function normalizeAgentTitle(value:string):string {
 const title=value.trim();
 if(!title||title.length>80||/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value))throw Error('Use a nonempty, single-line name of up to 80 characters.');
 return title;
}
/** Persist a Session title on the computer, then confirm the exact owned conversation. */
export async function renameAgentTitle(client:Pick<MobileClient,'action'|'conversations'>,conversation:Conversation,value:string):Promise<string>{
 if(conversation.kind!=='agent'||!conversation.agentId||!conversation.sessionId)throw Error('This Agent conversation is no longer available.');
 const result=await client.action<{title:string;seq:number}>('agent-rename',{agentId:conversation.agentId,sessionId:conversation.sessionId,title:normalizeAgentTitle(value)});
 const {conversations}=await client.conversations();
 const saved=conversations.find(item=>item.id===conversation.id&&item.kind==='agent'&&item.agentId===conversation.agentId&&item.sessionId===conversation.sessionId);
 if(!result||typeof result.title!=='string'||!Number.isSafeInteger(result.seq)||saved?.name!==result.title)throw Error('Could not confirm the conversation name was saved. Please try again.');
 return result.title;
}
