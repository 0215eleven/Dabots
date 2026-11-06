import test from 'node:test';import assert from 'node:assert/strict';
import {MobileClient,MemoryTokenStore} from '../index.js';
const token=()=>new MemoryTokenStore({accessToken:'synthetic',refreshToken:'synthetic-refresh',serverId:'fixture',deviceId:'synthetic-device',expiresAt:Date.now()+3600000});
const info=()=>Response.json({protocolVersion:1,serverId:'fixture'});
const make=response=>new MobileClient({baseUrl:'https://fixture.example',tokenStore:token(),fetch:async url=>new URL(url).pathname.endsWith('/info')?info():response});
test('native plain attachment payload avoids Blob and preserves scoped authenticated request',async t=>{
 let request;const client=new MobileClient({baseUrl:'https://fixture.example',tokenStore:token(),fetch:async(url,init)=>{if(new URL(url).pathname.endsWith('/info'))return info();request={url,init};return{ok:true,status:200,headers:new Headers({'content-type':'Image/PNG; charset=binary'}),attachmentData:async()=>({mimeType:'image/png',base64:Buffer.alloc(330000,42).toString('base64')}),blob:()=>assert.fail('no Blob roundtrip')}}});t.after(()=>client.dispose());
 const data=await client.attachmentData('bot','session','sha256:'+'a'.repeat(64),{seq:17});assert.equal(data.mimeType,'image/png');assert.equal(Buffer.from(data.base64,'base64').length,330000);assert.ok(request.url.includes('seq=17'));assert.equal(request.init.headers.Authorization,'Bearer synthetic');
});
test('streaming fallback is bounded and normalizes JPEG MIME without browser globals',async t=>{
 const bytes=Buffer.alloc(280000,99),response=new Response(bytes,{headers:{'content-type':'image/jpeg; charset=binary'}}),client=make(response);t.after(()=>client.dispose());
 const data=await client.attachmentData('bot','session','a',{seq:0});assert.equal(data.mimeType,'image/jpeg');assert.deepEqual(Buffer.from(data.base64,'base64'),bytes);
});
test('oversized, truncated, unsupported and malformed payloads have distinct safe errors',async t=>{
 for(const [headers,body,code] of [
  [{'content-type':'image/png','content-length':'100000000'},new Uint8Array(),'preview_size'],
  [{'content-type':'text/html'},new Uint8Array([1]),'preview_mime'],
  [{'content-type':'image/png','content-length':'4'},new Uint8Array([1,2]),'preview_truncated'],
 ]){const client=make(new Response(body,{headers}));t.after(()=>client.dispose());await assert.rejects(client.attachmentData('bot','session','a',{seq:0}),{code});}
 const client=make({ok:true,status:200,headers:new Headers({'content-type':'image/png'}),attachmentData:async()=>({mimeType:'image/png',base64:'bad base64'})});t.after(()=>client.dispose());await assert.rejects(client.attachmentData('bot','session','a',{seq:0}),{code:'preview_encoding'});
});
test('a cancelled native payload cannot complete after the client identity changes',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve}),client=make({ok:true,status:200,headers:new Headers({'content-type':'image/png'}),attachmentData:async()=>gate});t.after(()=>client.dispose());const controller=new AbortController(),pending=client.attachmentData('bot','session','a',{seq:0,signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));controller.abort();release({mimeType:'image/png',base64:'YWJj'});await assert.rejects(pending,{code:'cancelled'});
});
