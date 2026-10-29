import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenCommands, resolveScreenRoute, mutationProblem } from '../src/ds/screen-binding.ts';
import { DsCoreError } from '../src/ds/contracts.ts';
import { dsId } from '../src/ds/identity.ts';
import { projectTranscript } from '../src/ds/projection.ts';
const chatSource={id:'chat',kind:'bot',name:'Bot',sessionId:'s'};
const chatId=dsId('A','conversation','chat');
const chatRows=(id:string)=>projectTranscript('A',chatSource,[{id,sessionId:'s',seq:1,role:'assistant',text:id,createdAt:1}]);
const chatView=()=>({serverId:'A',conversations:[{id:chatId,source:chatSource}],agents:[]});

function fixture() {
  const calls: unknown[][] = [];
  const view = { serverId: 'A', bots: [{ id: dsId('A','bot','b'), conversationId: dsId('A','conversation','b') }], groups: [{ id: dsId('A','group','g'), conversationId: dsId('A','conversation','g') }], conversations: [{ id: dsId('A','conversation','b'), sourceId: 'b', kind: 'bot', ownerId: dsId('A','bot','b') }], models: [{ ref: 'dsh/custom:model', name: 'Desktop model' }], preferences: {}, capabilities: { actions: ['create-bot', 'update-bot', 'create-room', 'update-room', 'set-prefs'] } };
  const core: any = { read: () => view, modelOptions: async (ref: string) => ({model: view.models[0], efforts: [{id:'host-effort',name:'Host effort'}]}), ...Object.fromEntries(['createBot','updateBot','createGroup','updateGroup','setPreferences'].map(name => [name, async (...args: unknown[]) => {calls.push([name,...args]); return {status:'confirmed',value: args.at(-1)};}])) };
  return { calls, core, view };
}
test('real screen commands keep Bot/group fields and DSH IDs and canonical results', async () => {
 const {core,calls}=fixture(); const commands=createScreenCommands(core,'A');
 await commands.createBot({name:'Bot',model:'dsh/custom:model',effort:'host-effort'});
 await commands.updateBot(dsId('A','bot','b'),{role:'Reviewer'});
 await commands.createGroup({name:'Team',members:[dsId('A','bot','b')]});
 await commands.updateGroup(dsId('A','group','g'),{notice:'Notice',mode:'everyone'});
 assert.deepEqual(calls.map(x=>x[0]),['createBot','updateBot','createGroup','updateGroup']);
 assert.equal((calls[0][1] as any).model,'dsh/custom:model');
 assert.deepEqual((await commands.modelOptions('dsh/custom:model')).efforts,[{id:'host-effort',name:'Host effort'}]);
});
test('shared preference changes return canonical readback and exclude phone-only settings',async()=>{
 const {core,calls}=fixture(); const commands=createScreenCommands(core,'A');
 assert.deepEqual((await commands.setPreferences({theme:'dark',motion:'quiet'})).value,{theme:'dark',motion:'quiet'});
 assert.equal(calls.length,1);
});
test('stale form cannot write to newly selected host',async()=>{
 const {core,view,calls}=fixture(); const commands=createScreenCommands(core,'A'); view.serverId='B';
 await assert.rejects(async()=>commands.createBot({name:'Wrong host'}),{code:'STALE_HOST'}); assert.equal(calls.length,0);
});
test('deep links resolve known legacy IDs and reject foreign/unsupported routes',()=>{
 const {view}=fixture();
 assert.deepEqual(resolveScreenRoute(view as any,'chat','b'),{kind:'bot',id:dsId('A','bot','b')});
 assert.equal(resolveScreenRoute(view as any,'chat',dsId('B','bot','b')).kind,'unavailable');
 assert.equal(resolveScreenRoute(view as any,'providers','anything').kind,'unavailable');
});
test('management uncertainty blocks resubmission and distinguishes acknowledged from unknown',()=>{
 assert.equal(mutationProblem(new DsCoreError('READBACK_FAILED','readback',{mutation:'acknowledged'})).retry,false);
 assert.equal(mutationProblem(new DsCoreError('MUTATION_UNCONFIRMED','unknown',{mutation:'unknown'})).retry,false);
 assert.notEqual(mutationProblem(new DsCoreError('READBACK_FAILED','readback',{mutation:'acknowledged'})).message,mutationProblem(new DsCoreError('MUTATION_UNCONFIRMED','unknown',{mutation:'unknown'})).message);
});

test('chat binding starts cache/history/stream, prevents cache overwrite and releases old host',async()=>{
 const {createChatBinding}=await import('../src/ds/chat-controller.ts');
 let cacheResolve!: (rows:any[])=>void;let historyResolve!: (page:any)=>void;let listener:any;let released=0;
 const core:any={read:chatView,cachedHistory:()=>new Promise(r=>cacheResolve=r),history:()=>new Promise(r=>historyResolve=r),capabilities:()=>({stream:true,history:true}),watchConversation:(_id:string,l:any)=>{listener=l;return()=>released++}};
 const binding=createChatBinding(core,chatId);binding.start();
 listener.onSnapshot({messages:chatRows('live'),cursor:null});
 historyResolve({messages:chatRows('older-history'),cursor:null,sessionId:dsId('A','session','s')});cacheResolve(chatRows('stale-cache'));
 await new Promise(r=>setImmediate(r));assert.ok(binding.get().messages.some(message=>message.ds.source.id==='live'));
 binding.dispose();listener.onSnapshot({messages:chatRows('old-host')});assert.ok(binding.get().messages.some(message=>message.ds.source.id==='live'));assert.equal(released,1);
});
test('offline chat reads preserved cache without opening an unsupported stream',async()=>{
 const {createChatBinding}=await import('../src/ds/chat-controller.ts');let streams=0;
 const binding=createChatBinding({read:chatView,cachedHistory:async()=>chatRows('saved'),capabilities:()=>({stream:false,history:false}),watchConversation:()=>{streams++;throw Error('denied')}} as any,chatId);
 binding.start();await new Promise(r=>setImmediate(r));assert.equal(binding.get().messages[0].ds.source.id,'saved');assert.equal(streams,0);binding.dispose();
});
test('screen transcript renders DS reasoning/tool/attachment details and author IDs',async()=>{
 const {screenMessages}=await import('../src/ds/chat-binding.ts');
 const [row]=screenMessages([{id:'m',author:'assistant',senderAgentId:'ds:A:bot:b',text:'answer',createdAt:'now',status:'completed',ds:{author:{id:'b',name:'Reviewer'},source:{},reasoning:'why',tool:{name:'read',output:'result'},attachments:[{name:'proof.txt'}]}}] as any);
 assert.equal(row.speaker?.id,'ds:A:bot:b');assert.equal(row.speaker?.name,'Reviewer');for(const text of ['answer','why','read','proof.txt'])assert.ok(row.body.includes(text));
});
test('transcript presentation changes language without changing user content, names or canonical identity',async()=>{
 const {screenMessages}=await import('../src/ds/chat-binding.ts');
 const original={id:'ds:A:message:raw',author:'assistant',text:'Reasoning · user text',createdAt:'now',status:'completed',ds:{author:{id:'raw',name:'Tool'},source:{},reasoning:'Tool · raw reasoning',tool:{name:'Reasoning',output:'raw'}}};
 const catalog:Record<string,string>={Reasoning:'推理',Tool:'工具'};
 const [english]=screenMessages([original] as any);
 const [chinese]=screenMessages([original] as any,key=>catalog[key]??key);
 assert.ok(english.body.includes('\n\nReasoning\n'));
 assert.ok(chinese.body.includes('\n\n推理\nTool · raw reasoning'));
 assert.ok(chinese.body.includes('\n\n工具\n'));
 assert.equal(chinese.id,original.id);assert.equal(chinese.speaker?.name,'Tool');
 assert.ok(chinese.body.startsWith(original.text));assert.ok(chinese.body.includes('"name": "Reasoning"'));
 assert.equal(original.ds.reasoning,'Tool · raw reasoning');
});
test('actual provider binding reads current refs and rejects replaced client/outbox owners',async()=>{
 const {bindSessionCore}=await import('../src/ds/session-binding.ts');
 const client:any={};let snapshot:any={client,serverId:'A',source:'live',team:{bots:[],rooms:[],models:[],prefs:{theme:'paper'}},conversations:[]};
 const session:any={client,host:{serverId:'A'},outbox:null,workspace:{online:true,getSnapshot:()=>snapshot,refreshSnapshot:async()=>snapshot}};
 const core=bindSessionCore(session,()=>session)!;assert.equal(core.read().preferences.theme,'paper');
 snapshot={...snapshot,team:{...snapshot.team,prefs:{theme:'moonlight'}}};assert.equal(core.read().preferences.theme,'moonlight');
 session.outbox={};assert.throws(()=>core.read(),{code:'STALE_HOST'});session.outbox=null;session.client={};assert.throws(()=>core.read(),{code:'STALE_HOST'});core.dispose();
});
test('screen send preserves the pending intent on persistence uncertainty without allocating a replacement',async()=>{
 const {sendScreenMessage}=await import('../src/ds/screen-binding.ts');
 const existing={requestId:'original-request',conversationId:'chat',state:'unconfirmed',persistence:'unconfirmed',text:'hello',attachments:[]};let calls=0;
 const result=await sendScreenMessage({send:async()=>{calls++;throw Object.assign(Error('storage'),{code:'PERSISTENCE_UNCONFIRMED',requestId:'original-request'})},pending:()=>[existing]} as any,'chat','hello');
 assert.equal(calls,1);assert.equal(result.queued,null);assert.equal(result.existing,existing);assert.equal(result.problem?.retry,false);
});
