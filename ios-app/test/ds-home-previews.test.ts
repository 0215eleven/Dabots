import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createDsCore} from '../src/ds/core.ts';
import {dsId} from '../src/ds/identity.ts';
const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let items:any[]=[{id:'m',sessionId:'s',seq:1,role:'assistant',text:'authorized preview',createdAt:1000}],reads=0,cacheReads=0,active=true,gate:Promise<void>|undefined;
 const conversations:any[]=[{id:'c',kind:'bot',name:'Bot',sessionId:'s',updatedAt:1000}];
 const client:any={messages:async()=>{reads++;const page={messages:[...items],cursor:null,sessionId:'s'};await gate;return page;}};
 const snapshot:any={serverId:'h',client,source:'live',team:{bots:[{id:'c',name:'Bot'}],rooms:[],models:[],mobileCapabilities:{history:true,actions:[]}},conversations};
 const core=createDsCore({client,serverId:'h',outbox:null,getSnapshot:()=>snapshot,isCurrent:()=>active,isOnline:()=>true,refresh:async()=>snapshot});
 const access=()=>({owner:core,allowed:core.read().capabilities.history,read:async(id:string)=>(await core.history(dsId('h','conversation',id),{limit:6})).messages.map(m=>m.ds.source)});
 const session:any={client,host:{serverId:'h'},workspace:{online:true,getSnapshot:()=>snapshot}};
 const slots:any[]=[],effects:Array<()=>void>=[];let cursor=0;
 const same=(a:any[],b:any[])=>!!a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState(initial:any){const n=cursor++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return [slots[n],(v:any)=>{slots[n]=typeof v==='function'?v(slots[n]):v}];},useMemo(f:any,deps:any[]){const n=cursor++;if(!same(slots[n]?.deps,deps))slots[n]={deps,value:f()};return slots[n].value;},useEffect(f:any,deps:any[]){const n=cursor++;if(!same(slots[n]?.deps,deps)){const old=slots[n];slots[n]={deps};effects.push(()=>{old?.cleanup?.();slots[n].cleanup=f()});}}};
 const module={exports:{} as any};const code=transformSync(readFileSync(new URL('../src/home/usePreviews.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
 new Function('require','module','exports',code)((name:string)=>name==='react'?react:name==='../session/SessionProvider'?{useSession:()=>session}:name==='../storage'?{cache:{getMessages:async()=>{cacheReads++;return [{...items[0],text:'raw cache must not be used'}]}}}:name==='../logic/conversation-order'?{orderConversations:(c:any)=>c}:undefined,module,module.exports);
 let currentAccess=access();
 const render=()=>{cursor=0;return module.exports.usePreviews(conversations,currentAccess)};
 const flush=async()=>{while(effects.length)effects.shift()!();await tick();return render()};
 return {core,snapshot,session,conversations,render,flush,access:(a:any)=>{currentAccess=a},getAccess:access,items:(next:any[])=>{items=next},gate:(p:Promise<void>)=>{gate=p},invalidate:()=>{active=false},reads:()=>reads,cacheReads:()=>cacheReads};
}
test('DS previews use guarded history, never raw cached transcripts, and mask revoked grants immediately',async()=>{
 const f=fixture();f.render();const rows=await f.flush();assert.equal(rows.c?.text,'authorized preview');assert.equal(f.cacheReads(),0);
 f.snapshot.team.mobileCapabilities.history=false;f.access(f.getAccess());assert.deepEqual(f.render(),{});await f.flush();assert.equal(f.reads(),1);assert.equal(f.cacheReads(),0);f.core.dispose();
});
test('new connection on the same server cannot inherit an old preview before effects',async()=>{
 const f=fixture();f.render();await f.flush();f.session.client={messages:async()=>({messages:[],cursor:null})};f.access({...f.getAccess(),owner:{}});assert.deepEqual(f.render(),{});f.core.dispose();
});
test('empty canonical history replaces old summaries instead of merging them forever',async()=>{
 const f=fixture();f.render();await f.flush();f.items([]);f.conversations[0]={...f.conversations[0],updatedAt:2000};f.render();assert.deepEqual(await f.flush(),{});f.core.dispose();
});
test('late guarded reads after access revocation never publish transcript content',async()=>{
 const f=fixture();let release!:()=>void;f.gate(new Promise<void>(resolve=>{release=resolve}));f.render();await f.flush();f.snapshot.team.mobileCapabilities.history=false;f.access(f.getAccess());f.render();await f.flush();release();await tick();assert.deepEqual(f.render(),{});f.core.dispose();
});
