// Resource scheduling tests. Native storage is simulated; this does not assert device decoding.
import test from 'node:test';import assert from 'node:assert/strict';
import {createPreviewBudget} from '../src/ds/preview-budget.ts';import {loadPrivatePreview} from '../src/ds/preview-load.ts';import {previewResource} from '../src/ds/preview-resource.ts';import {previewRemover} from '../src/ds/preview-cleanup.ts';
const data=Object.freeze({name:'preview.png',mimeType:'image/png',base64:'YWJj',dimensions:{width:1,height:1}}),limits={resident:3,files:5,bytes:5*1048576,perFile:1048576,waiters:32,timeout:1000},tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){let nonce=0,peak=0,allowDelete=true;const files=new Set<string>();const api={createPreviewFile:async(input:{base64:string;mimeType:string})=>{assert.deepEqual(Object.keys(input).sort(),['base64','mimeType']);const id='dsbot-preview-10000000-0000-4000-8000-'+String(++nonce).padStart(12,'0')+'.png';files.add(id);peak=Math.max(peak,files.size);return{id,uri:'file:///tmp/'+id}},removePreviewFile:async(id:string)=>{if(!allowDelete)return false;files.delete(id);return true}};return{api,files,get peak(){return peak},block:()=>{allowDelete=false},unblock:()=>{allowDelete=true}};}
test('more than the resident capacity queues before any image bytes are read and cancellation advances FIFO',async()=>{
 const f=fixture(),budget=createPreviewBudget(limits),read:number[]=[],controller=new AbortController();
 const loads=Array.from({length:7},(_,i)=>loadPrivatePreview(f.api,async()=>{read.push(i);return data},{budget,...(i===4?{signal:controller.signal}:{})}));const cancelled=assert.rejects(loads[4],{name:'AbortError'});controller.abort();await cancelled;
 const first=await Promise.all(loads.slice(0,3));assert.deepEqual(read,[0,1,2]);assert.equal(budget.waiting,3);assert.equal(first[0].base64,'');
 await previewResource(first[0])!.dispose();const next=await loads[3];await previewResource(next)!.dispose();const fifth=await loads[5];await previewResource(fifth)!.dispose();const last=await loads[6];await previewResource(last)!.dispose();for(const value of first)await previewResource(value)!.dispose();assert.deepEqual(read,[0,1,2,3,5,6]);assert.equal(budget.used,0);assert.equal(budget.waiting,0);assert.ok(f.peak<=3);
});
test('full refresh keeps displayed files pinned and uses only the two bounded temporary slots',async()=>{
 const f=fixture(),budget=createPreviewBudget(limits),old=await Promise.all([0,1,2].map(()=>loadPrivatePreview(f.api,async()=>data,{budget}))),resources=old.map(value=>previewResource(value)!),unpin=resources.map(resource=>resource.retain());
 const replacements=await Promise.all([0,1].map(i=>loadPrivatePreview(f.api,async()=>data,{budget,previous:resources[i]})));assert.equal(f.files.size,5);
 assert.equal(await resources[0].dispose(),false);assert.equal(await resources[1].dispose(),false);assert.equal(f.files.size,5);unpin[0]();unpin[1]();await tick();assert.equal(f.files.size,3);assert.equal(budget.used,3);
 for(const next of replacements)await previewResource(next)!.dispose();await resources[2].dispose();assert.equal(budget.used,1);unpin[2]();await tick();assert.equal(budget.used,0);assert.equal(f.peak,5);
});
test('failed unlink continues to consume capacity until retained cleanup succeeds',async()=>{
 const f=fixture(),budget=createPreviewBudget({...limits,resident:1,files:2,bytes:2097152,timeout:5000}),first=await loadPrivatePreview(f.api,async()=>data,{budget});f.block();assert.equal(await previewResource(first)!.dispose(),false);assert.equal(budget.used,1);let reads=0;
 const waiting=loadPrivatePreview(f.api,async()=>{reads++;return data},{budget});await tick();assert.equal(reads,0);f.unblock();await previewRemover(f.api).retryPending();const second=await waiting;assert.equal(reads,1);await previewResource(second)!.dispose();assert.equal(budget.used,0);assert.equal(f.files.size,0);
});
test('old native fallback retains only bounded data URI resources and exports can still fetch fresh bytes',async()=>{
 const budget=createPreviewBudget({...limits,resident:1,files:2,bytes:2097152}),first=await loadPrivatePreview(null,async()=>data,{budget});assert.equal(first.base64,'');assert.equal(first.fileUri,'data:image/png;base64,YWJj');assert.equal(data.base64,'YWJj');const second=loadPrivatePreview(null,async()=>data,{budget});await tick();assert.equal(budget.waiting,1);await previewResource(first)!.dispose();const value=await second;await previewResource(value)!.dispose();assert.equal(budget.used,0);
});
test('capacity is retryable and cancellable; corrupt native failures are never retried',async()=>{
 const budget=createPreviewBudget(limits),controller=new AbortController();let calls=0;const api={createPreviewFile:async()=>{calls++;throw Object.assign(Error('full'),{code:'ERR_DS_PREVIEW_CAPACITY'})},removePreviewFile:async()=>true};
 const pending=loadPrivatePreview(api,async()=>data,{budget,signal:controller.signal}),denied=assert.rejects(pending,{name:'AbortError'});await tick();controller.abort();await denied;assert.equal(calls,1);assert.equal(budget.used,0);
 await assert.rejects(loadPrivatePreview({...api,createPreviewFile:async()=>{calls++;throw Object.assign(Error('corrupt'),{code:'CORRUPT_IMAGE'})}},async()=>data,{budget}),{code:'CORRUPT_IMAGE'});assert.equal(calls,2);assert.equal(budget.used,0);
});
