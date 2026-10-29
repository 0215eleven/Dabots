import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraft} from '../src/ds/draft.ts';
import {createDsCore} from '../src/ds/core.ts';
import {sendScreenMessage} from '../src/ds/screen-binding.ts';
import {dsId} from '../src/ds/identity.ts';
import type {DsCore} from '../src/ds/contracts.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = <T>() => {let resolve!: (v:T)=>void; const promise = new Promise<T>(r => {resolve=r;}); return {promise,resolve};};
function fixture(serverId='A') {
 let editable=true;
 const values=new Map<string,string>([[JSON.stringify(['A','original']), 'pre-upgrade draft']]);
 const calls:unknown[]=[];
 const cache={getDraft:async(s:string,c:string)=>{calls.push(['read',s,c]);return values.get(JSON.stringify([s,c]))??'';},setDraft:async(s:string,c:string,t:string)=>{calls.push(['write',s,c,t]);values.set(JSON.stringify([s,c]),t);}};
 const core={read:()=>({serverId}),capabilities:()=>({editDraft:editable})} as DsCore;
 return {cache,core,values,calls,editable:(v:boolean)=>{editable=v;},make:()=>createDraft(core,dsId(serverId,'conversation','original'),cache)};
}
test('old raw draft key restores, edit survives remount and fresh cache read; host scope differs',async()=>{
 const f=fixture(), d=f.make();await d.load();assert.equal(d.get(),'pre-upgrade draft');d.set('offline edit');d.dispose();const next=f.make();await next.load();assert.equal(next.get(),'offline edit');assert.equal(await f.cache.getDraft('A','original'),'offline edit');assert.equal(await f.cache.getDraft('B','original'),'');assert.deepEqual(f.calls[0],['read','A','original']);next.dispose();
});
test('new input (including empty) wins against late draft load and owner disposal',async()=>{
 const f=fixture(), saved=deferred<string>();f.cache.getDraft=()=>saved.promise;const d=f.make();const loading=d.load();await tick();d.set('');saved.resolve('old');await loading;assert.equal(d.get(),'');d.dispose();d.set('stale owner edit');await tick();assert.equal(f.values.get('["A","original"]'),'');
});
test('writes serialize across remount, and delayed send completion cannot clear new input',async()=>{
 const f=fixture(), first=deferred<void>();let count=0;const original=f.cache.setDraft;f.cache.setDraft=async(...args)=>{if(++count===1)await first.promise;await original(...args);};const d=f.make();d.set('one');await tick();d.dispose();const next=f.make();next.set('two');const sent=next.capture();next.set('newer');next.sent(sent);assert.equal(next.get(),'newer');first.resolve();await next.load();assert.equal(f.values.get('["A","original"]'),'newer');const at=next.capture();next.sent(at);await tick();assert.equal(f.values.get('["A","original"]'),'');next.dispose();
});
test('failed or unconfirmed enqueue retains draft; confirmed intent alone permits clear',async()=>{
 for(const mode of ['failed','unknown','empty','durable']) {const f=fixture(),d=f.make();d.set('intent');const at=d.capture();f.core.send=async()=>{if(mode==='failed')throw Error('disk failed');if(mode==='unknown')throw Object.assign(Error('unconfirmed'),{code:'PERSISTENCE_UNCONFIRMED',requestId:'r'});return mode==='empty'?null:{requestId:'r'} as any;};f.core.pending=()=>[];const result=await sendScreenMessage(f.core,dsId('A','conversation','original'),d.get());if(result.queued)d.sent(at);assert.equal(d.get(),mode==='durable'?'':'intent');d.dispose();}
});
test('cached offline chats edit locally; revoked and read-only snapshots refuse editing',()=>{
 const client={} as any;const snapshot={serverId:'A',client,source:'cache' as const,team:{bots:[],rooms:[],models:[],mobileCapabilities:{}},conversations:[],accessDenied:false};const core=createDsCore({client,serverId:'A',getSnapshot:()=>snapshot,isCurrent:()=>true,isOnline:()=>false,outbox:null,refresh:async()=>snapshot});assert.equal(core.capabilities().editDraft,true);assert.equal(core.capabilities().send,false);snapshot.accessDenied=true;assert.equal(core.capabilities().editDraft,false);snapshot.accessDenied=false;(snapshot.team as any).readOnly='locked';assert.equal(core.capabilities().editDraft,false);core.dispose();
});
