import test from 'node:test';import assert from 'node:assert/strict';
import {screenMessages} from '../src/ds/chat-binding.ts';
import {dsId} from '../src/ds/identity.ts';
const original='sha256:'+'a'.repeat(64),preview='sha256:'+'b'.repeat(64);
function message(attachments:any[]){return {id:dsId('computer','message','m'),author:'user',text:'看下',createdAt:'now',status:'completed',ds:{conversationId:dsId('computer','conversation','chief'),sessionId:dsId('computer','session','chat'),source:{id:'m',sessionId:'chat',seq:7},attachments}} as any;}
const photo={id:original,type:'file',name:'IMG_5064.png',size:201461,photo:true,preview:{id:preview,size:71082,mediaType:'image/png',width:640,height:480}};
test('a linked original becomes one scoped photo card with plain user text and explicit original facts',()=>{
 const [row]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-A'} as any);
 assert.equal(row.body,'看下');assert.equal(row.attachments?.length,1);
 const card=row.attachments![0] as any;assert.equal(card.kind,'image');assert.equal(card.downloadMode,'preview');assert.equal(card.name,'IMG_5064.png');assert.equal(card.size,71082);assert.deepEqual(card.originalFile,{name:'IMG_5064.png',size:201461});
 assert.ok(!row.body.includes('sha256'));assert.ok(!row.body.includes('Model preview'));
});
test('unlinked history and ordinary filenames remain independent, and old hosts never enable image downloads',()=>{
 const files=[{id:original,type:'file',name:'notes.txt',size:3},{id:preview,type:'image',name:'Model preview - notes.txt',size:70,previewAvailable:true,mediaType:'image/png',width:1,height:1}];
 const [row]=screenMessages([message(files)],s=>s,{previews:false,epoch:'epoch-A'} as any);
 assert.equal(row.attachments?.length,2);assert.ok(row.attachments?.every(a=>(a as any).downloadMode==='unavailable'));
 assert.equal(row.attachments?.[0].name,'notes.txt');assert.equal(row.attachments?.[1].name,'Model preview - notes.txt');
});
test('preview identities bind computer, connection, conversation, Session and exact message',async()=>{
 const {decodePreviewId}=await import('../src/ds/attachment-preview.ts');
 const [row]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-A'} as any);
 assert.deepEqual(decodePreviewId(row.attachments![0].id),{serverId:'computer',epoch:'epoch-A',conversationId:'chief',sessionId:'chat',seq:7,attachmentId:preview});
 const [next]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-B'} as any);assert.notEqual(next.attachments![0].id,row.attachments![0].id);
 assert.throws(()=>decodePreviewId('https://outside.example/image.png'));
});
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
test('preview loader carries exact message authorization and refuses oversized or non-image responses',async()=>{
 const {readPreview}=await import('../src/ds/attachment-preview.ts');const [row]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-A'} as any);let calls=0;
 const client={attachment:async(...args:any[])=>{calls++;assert.deepEqual(args.slice(0,3),['chief','chat',preview]);assert.equal(args[3].seq,7);return new Blob([png],{type:'image/png'});}} as any;
 const value=await readPreview(client,'computer','epoch-A',row.attachments![0].id,{current:()=>true});assert.equal(value.mimeType,'image/png');assert.equal(value.name,'preview.png');assert.ok(value.base64);
 await assert.rejects(readPreview(client,'foreign','epoch-A',row.attachments![0].id,{current:()=>true}));assert.equal(calls,1);
 for(const blob of [{size:1048577,type:'image/png',arrayBuffer:async()=>assert.fail('oversized body read')},new Blob(['html'],{type:'text/html'})]){
  await assert.rejects(readPreview({attachment:async()=>blob} as any,'computer','epoch-A',row.attachments![0].id,{current:()=>true}));
 }
});
test('aborted, revoked or switched connections cannot return preview bytes to a cache',async()=>{
 const {readPreview}=await import('../src/ds/attachment-preview.ts');const [row]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-A'} as any);
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(readPreview({attachment:async()=>{calls++;}} as any,'computer','epoch-A',row.attachments![0].id,{current:()=>true,signal:controller.signal}));assert.equal(calls,0);
 let release!:(value:Blob)=>void,allowed=true;const gate=new Promise<Blob>(resolve=>{release=resolve});
 const pending=readPreview({attachment:async()=>gate} as any,'computer','epoch-A',row.attachments![0].id,{current:()=>allowed});allowed=false;release(new Blob([png],{type:'image/png'}));await assert.rejects(pending);
});
