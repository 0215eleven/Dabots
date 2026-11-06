import test from 'node:test';
import assert from 'node:assert/strict';
import {createDsCore} from '../src/ds/core.ts';
import {dsId} from '../src/ds/identity.ts';
function fixture(){let active=true,online=true,calls=0;const client={action:async(name:string,payload:any)=>{calls++;assert.equal(name,'queue');assert.deepEqual(payload,{conversationId:'b'});return {conversationId:'b',sessionId:'s',items:[{id:'q',requestId:'desktop-request',target:'next-turn',text:'desktop queued'},{id:'step',target:'next-step',text:'step input'}]};}} as any;const snapshot={client,serverId:'A',source:'live' as const,team:{bots:[{id:'b',name:'B'}],rooms:[],models:[],mobileCapabilities:{actions:['queue']},readOnly:null as string|null},conversations:[{id:'b',name:'B',kind:'bot',sessionId:'s'}]};const core=createDsCore({client,serverId:'A',getSnapshot:()=>snapshot,isCurrent:()=>active,isOnline:()=>online,outbox:null,refresh:async()=>snapshot});return {core,client,snapshot,id:dsId('A','conversation','b'),calls:()=>calls,active:(v:boolean)=>{active=v;},online:(v:boolean)=>{online=v;}};}
test('public queue is read-only, scoped and includes desktop-originated input and target',async()=>{const f=fixture();f.snapshot.team.readOnly='migration';const q=await f.core.queue(f.id);assert.equal(q.items[0].requestId,'desktop-request');assert.equal(q.items[0].target,'next-turn');assert.equal(q.items[1].target,'next-step');assert.equal(q.sessionId,dsId('A','session','s'));assert.ok(f.core.capabilities().actions.includes('queue'));assert.equal(f.calls(),1);f.core.dispose();});
test('unsupported/offline/foreign entity queue never dispatches',async()=>{const f=fixture();f.snapshot.team.mobileCapabilities.actions=[];await assert.rejects(f.core.queue(f.id),{code:'UNSUPPORTED'});f.snapshot.team.mobileCapabilities.actions=['queue'];f.online(false);await assert.rejects(f.core.queue(f.id),{code:'OFFLINE'});f.online(true);await assert.rejects(f.core.queue(dsId('B','conversation','b')),{code:'INVALID_ID'});assert.equal(f.calls(),0);f.core.dispose();});
test('owner or session changes invalidate late queue replies',async()=>{for(const stage of ['owner','session','capability']){const f=fixture();f.client.action=async()=>{if(stage==='owner')f.active(false);else if(stage==='session')f.snapshot.conversations[0].sessionId='new';else f.snapshot.team.mobileCapabilities.actions=[];return {conversationId:'b',sessionId:'s',items:[]};};await assert.rejects(f.core.queue(f.id),{code:stage==='owner'?'STALE_HOST':stage==='session'?'STALE_SNAPSHOT':'UNSUPPORTED'});f.core.dispose();}});

import {createQueueObserver} from '../src/ds/queue-observer.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('queue observation bounds event reads, polls at 8s and clears late session/owner/background responses',async()=>{
 const f=fixture();let now=0,n=0;const timers=new Map<number,{at:number,fn:()=>void}>(),states:any[]=[];
 const clock={now:()=>now,set:(fn:()=>void,ms:number)=>{timers.set(++n,{at:now+ms,fn});return n as any;},clear:(id:any)=>{timers.delete(id);}};
 const advance=async(ms:number)=>{now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await tick();};
 const observer=createQueueObserver(f.core,f.id,s=>states.push(s),clock);observer.start();await advance(0);assert.equal(f.calls(),1);assert.equal(states.at(-1).hostQueue.items[0].text,'desktop queued');for(let i=0;i<50;i++)observer.event(dsId('A','session','s'));await advance(999);assert.equal(f.calls(),1);await advance(1);assert.equal(f.calls(),2);await advance(8000);assert.equal(f.calls(),3);
 let resolve!:(v:any)=>void;f.client.action=()=>new Promise(r=>{resolve=r;});observer.event();await advance(1000);observer.event(dsId('A','session','new'));assert.equal(states.at(-1).hostQueue,null);resolve({conversationId:'b',sessionId:'s',items:[]});await tick();assert.equal(states.at(-1).hostQueue,null);
 observer.setForeground(false);assert.equal(timers.size,0);await advance(10000);assert.equal(states.at(-1).hostQueue,null);observer.setForeground(true);await advance(0);observer.dispose();resolve({conversationId:'b',sessionId:'s',items:[]});await tick();assert.equal(timers.size,0);f.core.dispose();
});

test('a waiting message is steered or withdrawn by its request ID, and a missing one says so',async()=>{
 const f=fixture(),writes:any[]=[];const forgotten:string[]=[];
 f.snapshot.team.mobileCapabilities.actions=['queue','queue-remove','queue-steer'];
 f.client.action=async(name:string,payload:any)=>{if(name==='queue')return {conversationId:'b',sessionId:'s',items:[{id:'q',requestId:'mine',target:'next-turn',text:'stuck'}]};writes.push([name,payload]);return {};};
 const core=createDsCore({client:f.client,serverId:'A',getSnapshot:()=>f.snapshot as any,isCurrent:()=>true,isOnline:()=>true,outbox:{forgetSent:async(id:string)=>{forgotten.push(id);},list:()=>[],subscribe:()=>()=>{}} as any,refresh:async()=>f.snapshot as any});
 assert.deepEqual(await core.updateQueued(f.id,{requestId:'mine'},'steer'),{missing:false});
 assert.deepEqual(writes.at(-1),['queue-steer',{conversationId:'b',sessionId:'s',itemId:'q'}]);
 assert.deepEqual(forgotten,[],'a steered message reaches the transcript by itself');
 assert.deepEqual(await core.updateQueued(f.id,{requestId:'mine'},'remove'),{missing:false});
 assert.deepEqual(writes.at(-1),['queue-remove',{conversationId:'b',sessionId:'s',itemId:'q'}]);
 assert.deepEqual(forgotten,['mine'],'a withdrawn message loses its accepted card');
 assert.deepEqual(await core.updateQueued(f.id,{requestId:'gone'},'remove'),{missing:true});
 f.snapshot.team.mobileCapabilities.actions=['queue'];
 await assert.rejects(core.updateQueued(f.id,{requestId:'mine'},'steer'),{code:'UNSUPPORTED'});
});

test('group progress rounds render from an array, from older plugins\' spread object, and drop anything else',async()=>{
 const {groupRounds}=await import('../src/logic/group-work.ts');
 const round={callId:'c1',speaking:'b',replies:[{botId:'b',text:'hi',time:1},{kind:'user',text:'me'},null]};
 assert.deepEqual(groupRounds([round]),[{callId:'c1',speaking:'b',replies:[{botId:'b',text:'hi',time:1},{botId:'',kind:'user',text:'me'}]}]);
 assert.deepEqual(groupRounds({0:round,1:{callId:'c2',replies:'bad'}}).map(item=>[item.callId,item.replies.length]),[['c1',2],['c2',0]]);
 for(const value of [{},null,undefined,'x',[{nope:true}]])assert.deepEqual(groupRounds(value),[]);
});
