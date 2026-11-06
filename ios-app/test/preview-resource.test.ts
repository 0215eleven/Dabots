import test from 'node:test';import assert from 'node:assert/strict';
import {QueryClient,QueryObserver} from '@tanstack/react-query';
import {materializePreview,ownPreviewData,watchPreviewCache} from '../src/ds/preview-resource.ts';
import {createPreviewRemover} from '../src/ds/preview-cleanup.ts';
import {MobileClient,MemoryTokenStore} from '../sdk/index.js';
import {readPreview} from '../src/ds/attachment-preview.ts';
const id='dsbot-preview-10000000-0000-4000-8000-000000000001.png',data={mimeType:'image/png',base64:'YWJj'};
test('card and viewer share a private file until the last real query observer leaves',async()=>{
 let removed=0;const client=new QueryClient(),cache=client.getQueryCache();watchPreviewCache(cache);
 const resource=await materializePreview({createPreviewFile:async()=>({id,uri:'file:///tmp/'+id}),removePreviewFile:async()=>{removed++;return true}},data);
 const options={queryKey:['private-photo'],queryFn:async()=>ownPreviewData({...data,fileUri:resource!.uri},resource),gcTime:0,staleTime:Infinity,meta:{dsPrivatePreview:true},structuralSharing:false};
 const card=new QueryObserver(client,options),viewer=new QueryObserver(client,options),dropCard=card.subscribe(()=>{}),dropViewer=viewer.subscribe(()=>{});
 await card.refetch();assert.equal(removed,0);dropCard();assert.equal(removed,0);
 const gone=new Promise<void>(resolve=>{const unsubscribe=cache.subscribe(event=>{if(event.type==='removed'){unsubscribe();resolve()}})});dropViewer();await gone;assert.equal(removed,1);client.clear();assert.equal(removed,1);
});
test('revocation while a native file is being created removes it before exposing its URI',async()=>{
 let release!:(value:any)=>void,started!:()=>void,removed=0;const controller=new AbortController(),gate=new Promise<any>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{started=resolve});
 const pending=materializePreview({createPreviewFile:async()=>{started();return gate},removePreviewFile:async()=>{removed++;return true}},data,controller.signal);await ready;controller.abort();release({id,uri:'file:///tmp/'+id});await assert.rejects(pending,{name:'AbortError'});assert.equal(removed,1);
});
test('old native builds use memory fallback and untrusted native paths are never displayed',async()=>{
 assert.equal(await materializePreview(null,data),null);let removed=0;
 await assert.rejects(materializePreview({createPreviewFile:async()=>({id,uri:'https://outside.invalid/private'}),removePreviewFile:async()=>{removed++;return true}},data));assert.equal(removed,1);
});

test('connection removal disposes private files even with an observer; retry obtains a fresh resource',async()=>{
 const client=new QueryClient(),cache=client.getQueryCache();watchPreviewCache(cache);let removed=0,created=0;
 const options={queryKey:['scoped-preview','epoch-A'],meta:{dsPrivatePreview:true},structuralSharing:false,gcTime:0,queryFn:async()=>{
  const current=id.replace('000000000001',String(++created).padStart(12,'0'));
  const resource=await materializePreview({createPreviewFile:async()=>({id:current,uri:'file:///tmp/'+current}),removePreviewFile:async()=>{removed++;return true}},data);return ownPreviewData({...data,fileUri:resource!.uri},resource);
 }};
 const observer=new QueryObserver(client,options),unsubscribe=observer.subscribe(()=>{});await observer.refetch();assert.equal(created,1);client.removeQueries({queryKey:options.queryKey});assert.equal(removed,1);unsubscribe();
 const next=new QueryObserver(client,{...options,queryKey:['scoped-preview','epoch-B']}),drop=next.subscribe(()=>{});await next.refetch();assert.equal(created,2);client.clear();assert.equal(removed,2);drop();
});

test('failed native deletion retries boundedly, retains its handle and coalesces concurrent cleanup',async()=>{
 let calls=0,unlocked=false;const waits:number[]=[];
 const store=createPreviewRemover({removePreviewFile:async()=>{calls++;if(!unlocked)throw Error('Synthetic locked storage');return true}},async ms=>{waits.push(ms)});
 const first=store.remove(id),same=store.remove(id);assert.equal(first,same);assert.equal(await first,false);assert.equal(calls,4);assert.equal(store.pending,1);assert.deepEqual(waits,[50,250,1000]);
 unlocked=true;assert.equal(await store.retryPending(),true);assert.equal(calls,5);assert.equal(store.pending,0);
 assert.equal(await store.remove('../outside'),false);assert.equal(calls,5);
});

test('a false native deletion result does not mark the resource disposed or forget the owned handle',async()=>{
 let calls=0;const resource=await materializePreview({createPreviewFile:async()=>({id,uri:'file:///tmp/'+id}),removePreviewFile:async()=>++calls>1},data);
 await resource!.dispose();assert.equal(calls,2);await resource!.dispose();assert.equal(calls,2);
});

test('a real scoped download envelope crosses the native String dictionary boundary without its JS metadata',async t=>{
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
 const client=new MobileClient({baseUrl:'https://synthetic.invalid',tokenStore:new MemoryTokenStore({accessToken:'synthetic',refreshToken:'synthetic-refresh',serverId:'computer',deviceId:'synthetic-device',expiresAt:Date.now()+3600000}),fetch:async input=>String(input).endsWith('/info')?Response.json({protocolVersion:1,serverId:'computer'}):new Response(png,{headers:{'content-type':'image/png'}})});t.after(()=>client.dispose());
 const scoped='ds-preview-v1:'+encodeURIComponent(JSON.stringify(['computer','epoch','bot','session',7,'sha256:'+'a'.repeat(64)]));
 const envelope=Object.freeze(await readPreview(client,'computer','epoch',scoped,{current:()=>true}));assert.deepEqual(envelope.dimensions,{width:1,height:1});assert.equal(await materializePreview(null,envelope),null);
 let nativeBodyCalls=0,received:unknown,removed=0;
 const resource=await materializePreview({createPreviewFile:async input=>{
  // Expo core 58.0.28 DynamicDictionaryType converts every defined value via DynamicStringType.
  for(const [key,value] of Object.entries(input))if(value!==undefined&&typeof value!=='string')throw new TypeError('Native string dictionary rejected '+key);
  nativeBodyCalls++;received=input;return{id,uri:'file:///tmp/'+id};
 },removePreviewFile:async()=>{removed++;return true}},envelope);
 assert.equal(nativeBodyCalls,1);assert.notEqual(received,envelope);assert.deepEqual(received,{base64:envelope.base64,mimeType:envelope.mimeType});assert.deepEqual(envelope.dimensions,{width:1,height:1});assert.equal(envelope.name,'preview.png');await resource!.dispose();assert.equal(removed,1);
});
