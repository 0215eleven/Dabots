import test from 'node:test';import assert from 'node:assert/strict';
import {uploadAttachments,validateSelectedUploads,LEGACY_UPLOAD_LIMITS} from '../src/logic/upload-attachments.ts';
const file={id:'one',name:'synthetic.txt',mimeType:'text/plain',base64:'b2s=',size:2};
test('selected bytes go only to the exact paired target and a partial/cancelled batch removes its unused receipts',async()=>{
 const calls:any[]=[],removed:string[]=[],client:any={target:async(id:string)=>{assert.equal(id,'chief');return{sessionId:'session'}},upload:async(body:any)=>{calls.push(body);return{receiptId:'r',name:body.name,size:2}},removeUpload:async(id:string)=>removed.push(id)};
 const result=await uploadAttachments(client,'chief',[file]);assert.equal(result[0].receiptId,'r');assert.equal(calls[0].sessionId,'session');assert.deepEqual([...new Uint8Array(calls[0].body)],[111,107]);
 client.upload=async(body:any)=>{if(body.name==='second.txt')throw Error('connection lost');return{receiptId:'r',name:body.name,size:2}};
 await assert.rejects(uploadAttachments(client,'chief',[file,{...file,id:'two',name:'second.txt'}]),/connection lost/);assert.deepEqual(removed,['r']);
 const abort=new AbortController();abort.abort();await assert.rejects(uploadAttachments(client,'chief',[file],abort.signal));
 for(const name of ['../a.txt','a.exe','a\\b.txt'])assert.throws(()=>validateSelectedUploads([{...file,name}]));assert.throws(()=>validateSelectedUploads([{...file,size:2097153}],LEGACY_UPLOAD_LIMITS));
});
test('invalid confirmations are cleaned and selection count and total bytes stay bounded',async()=>{
 const removed:string[]=[];
 const client:any={target:async()=>({sessionId:'s'}),upload:async()=>({receiptId:'wrong',name:'changed.txt',size:2}),removeUpload:async(id:string)=>removed.push(id)};
 await assert.rejects(uploadAttachments(client,'chief',[file]),/did not confirm/);
 assert.deepEqual(removed,['wrong']);
 assert.throws(()=>validateSelectedUploads(Array(5).fill(file)));
 assert.throws(()=>validateSelectedUploads(Array(3).fill({...file,size:2097152}),LEGACY_UPLOAD_LIMITS));
 assert.doesNotThrow(()=>validateSelectedUploads([{...file,size:100000000}]));
 assert.throws(()=>validateSelectedUploads([{...file,size:100000001}]));
 assert.throws(()=>validateSelectedUploads([{...file,size:100000000},{...file,id:'two',size:1}]));
 assert.throws(()=>validateSelectedUploads([{...file,name:'photo.png',mimeType:'text/plain'}]));
});
