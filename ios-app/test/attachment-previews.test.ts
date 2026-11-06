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

test('preview header validation does not require a browser atob global',async t=>{
 const previous=globalThis.atob;globalThis.atob=undefined as any;t.after(()=>{globalThis.atob=previous});
 const {readPreview}=await import('../src/ds/attachment-preview.ts'),[row]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-A'} as any);
 const result=await readPreview({attachment:async()=>new Blob([png],{type:'image/png'})} as any,'computer','epoch-A',row.attachments![0].id,{current:()=>true});assert.equal(result.mimeType,'image/png');
});

test('a bounded JPEG header scan accepts progressive SOF after multiple large metadata segments',async()=>{
 const app=Buffer.alloc(60004,0);app[0]=255;app[1]=225;app.writeUInt16BE(60002,2);
 const sof=Buffer.from([255,194,0,17,8,6,0,2,192,3,1,17,0,2,17,0,3,17,0,255,218,0,2]);
 const jpeg=Buffer.concat([Buffer.from([255,216]),app,app,sof]);
 const {readPreview}=await import('../src/ds/attachment-preview.ts'),[row]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-A'} as any);
 const result=await readPreview({attachment:async()=>new Blob([jpeg],{type:'image/jpeg'})} as any,'computer','epoch-A',row.attachments![0].id,{current:()=>true});assert.equal(result.mimeType,'image/jpeg');
});
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

test('multiple visible photos respect the desktop read quota and a queued cancellation never downloads',async()=>{
 const {readPreview}=await import('../src/ds/attachment-preview.ts'),[row]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-A'} as any);
 let active=0,peak=0,calls=0;const gates:Array<()=>void>=[],controller=new AbortController();
 const client={attachment:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>gates.push(resolve));active--;return new Blob([png],{type:'image/png'});}} as any;
 const reads=Array.from({length:4},(_,index)=>readPreview(client,'computer','epoch-A',row.attachments![0].id,{current:()=>true,...(index===2?{signal:controller.signal}:{})})),settled=Promise.allSettled(reads);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(active,2);controller.abort();
 gates.splice(0).forEach(release=>release());await new Promise(resolve=>setImmediate(resolve));gates.splice(0).forEach(release=>release());
 const results=await settled;assert.equal(results.filter(r=>r.status==='fulfilled').length,3);assert.equal(results[2].status,'rejected');assert.equal(peak,2);assert.equal(calls,3);
});

test('plain payloads reserve validated dimensions and distinguish safe failure stages without raw host errors',async()=>{
 const {readPreview}=await import('../src/ds/attachment-preview.ts'),[row]=screenMessages([message([photo])],s=>s,{previews:true,epoch:'epoch-A'} as any),id=row.attachments![0].id;
 const read=(client:any)=>readPreview(client,'computer','epoch-A',id,{current:()=>true});
 const data={mimeType:'Image/PNG; charset=binary',base64:Buffer.from(png).toString('base64')};
 const result=await read({attachmentData:async()=>data,attachment:()=>assert.fail('plain native value must not round-trip through Blob')});assert.deepEqual(result.dimensions,{width:1,height:1});
 for(const [value,code] of [[{...data,base64:'bad payload'},'PREVIEW_ENCODING'],[{...data,mimeType:'image/jpeg'},'PREVIEW_FORMAT'],[{...data,mimeType:'text/html'},'PREVIEW_MIME'],[{...data,base64:''},'PREVIEW_EMPTY']])await assert.rejects(read({attachmentData:async()=>value}),{code});
 for(const [failure,code] of [[{status:403},'PREVIEW_AUTH'],[{code:'session_changed'},'PREVIEW_AUTH'],[{code:'preview_size'},'PREVIEW_SIZE'],[{status:404},'PREVIEW_UNAVAILABLE'],[{},'PREVIEW_NETWORK']])await assert.rejects(read({attachmentData:async()=>{throw Object.assign(Error('secret/path/synthetic'),failure)}}),error=>{assert.ok(!String(error).includes('secret/path'));return(error as any).code===code});
});
