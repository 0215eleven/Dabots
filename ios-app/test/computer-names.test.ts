import test from 'node:test';
import assert from 'node:assert/strict';
import {computerName, createComputerNameStore, normalizeComputerName} from '../src/logic/computer-names.ts';

function storage(){
 const records=new Map<string,unknown>();let blocked=false;
 return {records,block:(value:boolean)=>{blocked=value},read:async(s:string,k:string)=>records.get(s+'/'+k)??null,write:async(s:string,k:string,v:unknown)=>{if(!blocked)records.set(s+'/'+k,v)}};
}
const a={serverId:'A',slot:'one',name:'Desktop A',url:'https://a.example'},b={serverId:'B',slot:'two',name:'Desktop B',url:'https://b.example'};
test('one display name falls back to the paired computer and accepts Chinese and emoji nicknames',()=>{
 assert.equal(computerName(a,{}),'Desktop A');assert.equal(computerName(null,{}),'Dabots');
 assert.equal(computerName({...a,name:'DeepSeek Bot Pro'},{}),'DeepSeek Bot Pro');
 assert.equal(computerName(a,{A:'DS Bot'}),'DS Bot');
 assert.equal(normalizeComputerName('  我的电脑 🤖  '),'我的电脑 🤖');
 assert.equal(computerName(a,{A:'家里的电脑'}),'家里的电脑');assert.equal(computerName(b,{A:'家里的电脑'}),'Desktop B');
 assert.equal(computerName({...a,serverId:'constructor'},{}),'Desktop A');
 for(const name of ['', '   ','line\nbreak','Top\u2028Bottom','Top\u2029Bottom','Top\u0085Bottom','x'.repeat(41)])assert.throws(()=>normalizeComputerName(name));
 assert.equal(normalizeComputerName('🤖'.repeat(40)),'🤖'.repeat(40));
});
test('rename, reload and reset preserve host isolation and connection identities',async()=>{
 const io=storage(),store=createComputerNameStore(io),original=structuredClone([a,b]);
 await Promise.all([store.load('A'),store.load('B')]);await store.rename('A','家里的电脑');
 assert.equal(computerName(a,store.getSnapshot()),'家里的电脑');assert.equal(computerName(b,store.getSnapshot()),'Desktop B');
 const restored=createComputerNameStore(io);await restored.load('A');assert.equal(computerName(a,restored.getSnapshot()),'家里的电脑');
 await restored.rename('A',null);assert.equal(computerName(a,restored.getSnapshot()),'Desktop A');
 assert.deepEqual([a,b],original);assert.equal(io.records.has('B/computer-name'),false);
});
test('delayed initial reads finish before a rename publishes and cannot overwrite it',async()=>{
 let release!:(value:unknown)=>void;let saved:unknown=null,first=true;
 const pending=new Promise(resolve=>{release=resolve});
 const store=createComputerNameStore({read:async()=>first?(first=false,pending):saved,write:async(_s,_k,value)=>{saved=value}});
 const loading=store.load('A'),saving=store.rename('A','New name');release('Old name');await Promise.all([loading,saving]);
 assert.equal(computerName(a,store.getSnapshot()),'New name');assert.equal(saved,'New name');
});
test('rapid saves and a later reset are serialized without losing another computer name',async()=>{
 const io=storage(),store=createComputerNameStore(io);
 await Promise.all([store.rename('A','First'),store.rename('A','Second'),store.rename('B','Office'),store.rename('A',null)]);
 assert.equal(computerName(a,store.getSnapshot()),'Desktop A');assert.equal(computerName(b,store.getSnapshot()),'Office');
 assert.equal(io.records.get('A/computer-name'),null);assert.equal(io.records.get('B/computer-name'),'Office');
});
test('a swallowed browser write cannot publish success or destroy the last confirmed name',async()=>{
 const io=storage(),store=createComputerNameStore(io);await store.rename('A','Saved');io.block(true);
 await assert.rejects(store.rename('A','Lost'),/confirm/);assert.equal(computerName(a,store.getSnapshot()),'Saved');
 io.block(false);await store.rename('A','Retry');assert.equal(computerName(a,store.getSnapshot()),'Retry');
});
test('read failure prevents writes, invalid input is rejected, and pending removal clears the nickname last',async()=>{
 let writes=0;const bad=createComputerNameStore({read:async()=>{throw Error('storage blocked')},write:async()=>{writes++}});
 await assert.rejects(bad.rename('A','New'),/read/);assert.equal(writes,0);
 const io=storage(),store=createComputerNameStore(io);await assert.rejects(store.rename('A',' '));assert.equal(io.records.size,0);
 await Promise.all([store.rename('A','Temporary'),store.rename('A',null)]);assert.equal(computerName(a,store.getSnapshot()),'Desktop A');
});
test('failed removal is remembered and retried before a repaired computer can revive its nickname',async()=>{
 const io=storage(),store=createComputerNameStore(io);await store.rename('A','Old private label');io.block(true);
 await assert.rejects(store.forget('A'),/confirm/);assert.equal(computerName(a,store.getSnapshot()),'Desktop A');
 io.block(false);await store.load('A');assert.equal(io.records.get('A/computer-name'),null);assert.equal(computerName(a,store.getSnapshot()),'Desktop A');
});
