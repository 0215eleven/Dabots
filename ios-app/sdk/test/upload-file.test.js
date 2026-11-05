import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '@noble/hashes/sha2.js';
import {uploadFile} from '../upload-file.js';
const hex=value=>Array.from(value,x=>x.toString(16).padStart(2,'0')).join('');
const limits={maxBytes:100000000,chunkBytes:262144,previewBytes:2097152};
function fixture({loseAck=false,failedStatus=0}={}){
 let offset=0,deleted=false,metadata,hash=sha256.create(),reads=0,puts=0;const id='10000000-0000-4000-8000-000000000001';
 const request=async(path,options={})=>{
  if(path==='/upload-transfers'){metadata=options.json;return {id,offset,size:metadata.size,name:metadata.name}}
  if(options.method==='DELETE'){deleted=true;return{removed:true}}
  if(options.method==='PUT'){const start=Number(new URL(path,'http://test').searchParams.get('offset'));assert.equal(start,offset);assert.ok(options.body.length<=limits.chunkBytes);hash.update(options.body);offset+=options.body.length;puts++;if(loseAck){loseAck=false;throw Error('Synthetic lost acknowledgement')}return{id,offset}}
  if(path.endsWith('/complete')){const expected=hex(hash.digest());assert.equal(options.json.sha256,expected);return{receiptId:id,name:metadata.name,size:offset,sha256:expected}}
  if(failedStatus-->0)throw Error('Synthetic reconnect still closing');return{id,offset,size:metadata.size,name:metadata.name};
 };
 return {request,get deleted(){return deleted},get puts(){return puts},source:size=>({size,read:async(offset,length)=>{reads++;assert.ok(length<=262144);return new Uint8Array(length).fill(offset%251)}}),get reads(){return reads}};
}
const options={conversationId:'bot',sessionId:'s',clientId:'synthetic',name:'synthetic.txt',mediaType:'text/plain',kind:'file'};
test('100 MB is read and acknowledged a chunk at a time and verified by a complete SHA-256',async()=>{
 const f=fixture(),source=f.source(100000000),progress=[];
 const receipt=await uploadFile(f.request,{...options,...source,onProgress:(done,total)=>progress.push([done,total])},limits);
 assert.equal(receipt.size,100000000);assert.equal(receipt.protocol,2);assert.ok(f.reads>300);assert.equal(f.puts,f.reads);
 assert.deepEqual(progress.at(-1),[100000000,100000000]);assert.equal(f.deleted,false);
});
test('a lost chunk acknowledgement resumes from durable status without replaying accepted bytes',async()=>{
 const f=fixture({loseAck:true}),source=f.source(700000);
 assert.equal((await uploadFile(f.request,{...options,...source},limits)).size,700000);assert.equal(f.puts,3);
});
test('status recovery tolerates a bounded reconnect delay before any mutation is retried',async()=>{
 const f=fixture({loseAck:true,failedStatus:1});assert.equal((await uploadFile(f.request,{...options,...f.source(700000)},limits)).size,700000);assert.equal(f.puts,3);
});
test('cancellation removes the partial transfer and never completes',async()=>{
 const f=fixture(),controller=new AbortController();
 await assert.rejects(uploadFile(f.request,{...options,...f.source(700000),signal:controller.signal,onProgress:done=>{if(done>0)controller.abort()}},limits));
 assert.equal(f.deleted,true);assert.equal(f.puts,1);
});
test('oversized sources and unnegotiated or unsafe chunk limits are refused before reading',async()=>{
 const f=fixture();for(const [size,policy] of [[100000001,limits],[10,null],[10,{...limits,chunkBytes:100000000}]])await assert.rejects(uploadFile(f.request,{...options,...f.source(size)},policy));
 assert.equal(f.reads,0);
});
test('an invalid transfer identifier cannot redirect cancellation to another authenticated endpoint',async()=>{
 const paths=[];await assert.rejects(uploadFile(async path=>{paths.push(path);return{id:'../../devices/other',size:3,name:options.name}}, {...options,size:3,read:async()=>assert.fail('invalid metadata')},limits));
 assert.deepEqual(paths,['/upload-transfers']);
});
