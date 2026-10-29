import test from 'node:test';
import assert from 'node:assert/strict';
import type {MobileClient,Message,MobileEvent} from '@ds-bot/mobile-sdk';
import {createDsCore} from '../src/ds/core.ts';
import {createChatBinding} from '../src/ds/chat-controller.ts';
import {conversationStreams,watchConversationStreamLifecycle} from '../src/logic/conversation-streams.ts';
import {dsId} from '../src/ds/identity.ts';
import type {TeamState} from '../src/types.ts';
const tick=()=>new Promise(r=>setImmediate(r));
const message=(id:string,text=id):Message=>({id,text,sessionId:'s',seq:id==='older'?1:2,role:'assistant',createdAt:1});
function fixture(){
 let opened=0,closed=0; let emit:(e:MobileEvent)=>void=()=>{};
 let history=async (_id:string,options?:{cursor?:string|null})=>({messages:[message('latest')],cursor:'older',sessionId:'s'});
 const client={getCachedMessages:async()=>[message('saved')],messages:(id:string,options?:{cursor?:string|null})=>history(id,options),connect:(options:{onEvent:(e:MobileEvent)=>void})=>{opened++;emit=options.onEvent;return{close(){closed++},reconnectNow(){}}}} as unknown as MobileClient;
 const team:TeamState={bots:[{id:'b',name:'Bot',sessionId:'s'}],rooms:[],models:[],mobileCapabilities:{history:true,stream:true}};
 const snapshot={client,serverId:'host',team,conversations:[{id:'b',kind:'bot',name:'Bot',sessionId:'s'}],source:'live' as const};
 const core=createDsCore({client,serverId:'host',getSnapshot:()=>snapshot,refresh:async()=>snapshot,isCurrent:()=>true,isOnline:()=>true,outbox:null});
 const binding=createChatBinding(core,dsId('host','conversation','b'));
 return{client,core,binding,setHistory:(fn:typeof history)=>{history=fn},emit:(messages:Message[],sessionId='s')=>emit({type:'reset',conversationId:'b',sessionId,messages,eventSeq:1}),event:(event:MobileEvent)=>emit(event),counts:()=>({opened,closed}),dispose(){binding.dispose();core.dispose();conversationStreams.clear(client)}};
}
test('actual pool connecting replay cannot suppress successful HTTP history',async()=>{const f=fixture();try{f.binding.start();await tick();assert.deepEqual(f.binding.get().messages.map(m=>m.ds.source.id),['latest']);assert.equal(f.binding.get().cursor,'older')}finally{f.dispose()}});
test('older-page/live overlap retains loaded pages and newest content/cursor',async()=>{const f=fixture();try{f.binding.start();await tick();f.emit([message('latest','live one')]);let resolve!:(page:{messages:Message[];cursor:string;sessionId:string})=>void;f.setHistory(async()=>new Promise(r=>resolve=r));const loading=f.binding.load(true);f.emit([message('latest','live two')]);resolve({messages:[message('older'),message('latest','stale history')],cursor:'earliest',sessionId:'s'});await loading;f.emit([message('latest','live three')]);assert.deepEqual(f.binding.get().messages.map(m=>m.ds.source.id),['older','latest']);assert.equal(f.binding.get().messages[1].text,'live three');assert.equal(f.binding.get().cursor,'earliest')}finally{f.dispose()}});
test('actual lifecycle clear then foreground reacquires stream while online remains true',async()=>{const f=fixture();let update=(state:string)=>{};const stop=watchConversationStreamLifecycle(f.client,{currentState:'active',addEventListener:(_event,listener)=>{update=listener;return{remove(){}}}},active=>{if('setForeground' in f.binding)(f.binding.setForeground as (value:boolean)=>void)(active)});try{f.binding.start();await tick();update('background');update('active');await tick();assert.deepEqual(f.counts(),{opened:2,closed:1});f.emit([message('latest','resumed')]);assert.equal(f.binding.get().messages.at(-1)?.text,'resumed')}finally{stop();f.dispose()}});

test('actual stream session rollover drops previous-session pages and rejects their late HTTP result',async()=>{const f=fixture();try{f.binding.start();await tick();f.emit([message('latest')]);let resolve!:(page:{messages:Message[];cursor:string;sessionId:string})=>void;f.setHistory(async()=>new Promise(r=>resolve=r));const loading=f.binding.load(true);f.event({type:'ready',conversationId:'b',sessionId:'next'});f.emit([{...message('new'),sessionId:'next'}],'next');resolve({messages:[message('older')],cursor:'old-page',sessionId:'s'});await loading;assert.deepEqual(f.binding.get().messages.map(m=>m.ds.source.id),['new']);assert.equal(f.binding.get().cursor,null)}finally{f.dispose()}});
test('HTTP history replaces stale cached overlap while unrelated live rows remain newer',async()=>{const f=fixture();try{let resolve!:(page:{messages:Message[];cursor:string;sessionId:string})=>void;f.setHistory(async()=>new Promise(r=>resolve=r));f.binding.start();await tick();f.emit([message('latest','live')]);resolve({messages:[message('saved','canonical HTTP')],cursor:'older',sessionId:'s'});await tick();assert.equal(f.binding.get().messages.find(m=>m.ds.source.id==='saved')?.text,'canonical HTTP');assert.equal(f.binding.get().messages.find(m=>m.ds.source.id==='latest')?.text,'live')}finally{f.dispose()}});
