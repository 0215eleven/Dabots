import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAgentTitle,renameAgentTitle} from '../src/logic/agent-title.ts';
const conversation:any={id:'agent:a:s',agentId:'a',sessionId:'s',kind:'agent',name:'Old'};
test('Agent titles validate one visible line without silently truncating',()=>{
 assert.equal(normalizeAgentTitle('  New name  '),'New name');
 for(const input of ['', '  ','x\ny','x\u2028y','x\u2029y','x'.repeat(81)])assert.throws(()=>normalizeAgentTitle(input));
});
test('rename requires a matching server readback; a failed confirmation stays retryable',async()=>{
 const calls:any[]=[];let saved='Old';
 const client:any={action:async(endpoint:string,payload:any)=>{calls.push([endpoint,payload]);saved=payload.title;return{title:saved,seq:8}},conversations:async()=>({conversations:[{...conversation,name:saved}]})};
 assert.equal(await renameAgentTitle(client,conversation,' New '),'New');
 assert.deepEqual(calls,[['agent-rename',{agentId:'a',sessionId:'s',title:'New'}]]);
 client.conversations=async()=>({conversations:[{...conversation,sessionId:'other',name:'New'}]});
 await assert.rejects(renameAgentTitle(client,conversation,'Other'),/confirm/);
 await assert.rejects(renameAgentTitle(client,{...conversation,kind:'bot'},'Other'));
});
