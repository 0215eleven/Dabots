import test from 'node:test'
import assert from 'node:assert/strict'
import {createAdapter} from '../src/adapter.mjs'
import {createHash} from 'node:crypto'

const id='sha256:'+'a'.repeat(64),other='sha256:'+'b'.repeat(64)
const input={conversationId:'chief',sessionId:'chat',seq:7,attachmentId:id}
async function fixture(t,{ref={},read}={}){
 const image={attachmentId:id,name:'synthetic.png',mediaType:'image/png',bytes:80,width:40,height:30,...ref}
 const state={revision:1,bots:[{id:'chief',name:'Chief',sessionId:'chat',parts:[]}],rooms:[],agents:[]},calls=[]
 const record={event:{type:'user/message',seq:7,data:{source:{kind:'user',rpcId:'synthetic_request'},content:[{type:'image',attachment:image}]}}}
 const adapter=createAdapter({fixtureText:true,connection:{createSharedFetchHandler:()=>({fetch:async request=>{const {endpoint,payload}=await request.json();return Response.json({ok:true,value:endpoint==='state'?state:endpoint==='bridge.redact'?{texts:payload.texts}:{version:1,redactedText:true}})}})},
  sessionController:{page:async args=>{calls.push(args);return {records:[record]}}},
  attachmentStore:{readImageRequest:async(...args)=>{calls.push('read');return read?read(...args):{data:new Uint8Array([1,2,3]),mediaType:'image/png',bytes:3,width:40,height:30}}}})
 t.after(()=>adapter.dispose());await adapter.initialize();return {adapter,calls,state,record}
}
test('preview reads only the normalized image on the exact visible message',async t=>{
 const {adapter,calls}=await fixture(t)
 const result=await adapter.attachment(input,AbortSignal.timeout(3000))
 assert.deepEqual([...result.bytes],[1,2,3]);assert.equal(result.mediaType,'image/png')
 assert.equal(calls[0].address.sessionId,'chat');assert.equal(calls[0].throughSeq,7)
 assert.equal(adapter.capabilities().attachmentPreviews,1)
})
test('foreign Session, message, hash and unsafe identifiers never read stored bytes',async t=>{
 const {adapter,calls}=await fixture(t)
 for(const [value,code] of [[{...input,sessionId:'foreign'},'SESSION_DENIED'],[{...input,seq:8},'PREVIEW_UNAVAILABLE'],[{...input,attachmentId:other},'PREVIEW_UNAVAILABLE'],[{...input,attachmentId:'../private'},'INVALID_PREVIEW'],[{...input,seq:-1},'INVALID_PREVIEW']]){
  await assert.rejects(adapter.attachment(value,AbortSignal.timeout(3000)),{code})
 }
 assert.equal(calls.includes('read'),false)
})
test('large originals and excessive image dimensions never enter the preview decoder',async t=>{
 for(const ref of [{bytes:100000000},{width:8192,height:8192}]){
  const {adapter,calls}=await fixture(t,{ref})
  await assert.rejects(adapter.attachment(input,AbortSignal.timeout(3000)),{code:'PREVIEW_UNAVAILABLE'})
  assert.equal(calls.includes('read'),false)
 }
})
test('oversized output, cancellation and conversation removal cannot release a preview',async t=>{
 const large=await fixture(t,{read:async()=>({data:new Uint8Array(1048577),bytes:1048577,mediaType:'image/png',width:40,height:30})})
 await assert.rejects(large.adapter.attachment(input,AbortSignal.timeout(3000)),{code:'PREVIEW_UNAVAILABLE'})
 const aborted=await fixture(t),controller=new AbortController();controller.abort()
 await assert.rejects(aborted.adapter.attachment(input,controller.signal),{name:'AbortError'});assert.equal(aborted.calls.includes('read'),false)
 let context;context=await fixture(t,{read:async()=>{context.state.bots=[];return {data:new Uint8Array([1]),bytes:1,mediaType:'image/png',width:1,height:1}}})
 await assert.rejects(context.adapter.attachment(input,AbortSignal.timeout(3000)),{code:'CONVERSATION_NOT_FOUND'})
})

test('submit records trusted original/preview ordinal links before prompting, regardless of names',async t=>{
 const bytes=Buffer.from('photo'),sha256=createHash('sha256').update(bytes).digest('hex'),original='10000000-0000-4000-8000-000000000001'
 const events=[],proof=[]
 const adapter=createAdapter({fixtureText:true,connection:{createSharedFetchHandler:()=>({fetch:async request=>{
  if(new URL(request.url).pathname.endsWith('uploadFileBinary'))return Response.json({ok:true,value:{receiptId:original,file:{bytes:5,attachmentId:'sha256:'+sha256}}})
  const {endpoint,payload}=await request.json()
  if(endpoint==='state')return Response.json({ok:true,value:{bots:[{id:'chief',name:'Chief',sessionId:'chat',parts:[]}],rooms:[]}})
  if(endpoint==='bridge.describe')return Response.json({ok:true,value:{version:1,stableRequestId:true,attachments:1,uploadTransfers:1}})
  if(endpoint==='bridge.submit'){events.push('prompt');return Response.json({ok:true,value:{accepted:true,sessionId:'chat',requestId:payload.requestId}})}
  throw Error('Unexpected endpoint')
 }})}})
 t.after(()=>adapter.dispose());await adapter.initialize()
 await adapter.submit({conversationId:'chief',sessionId:'chat',requestId:'synthetic_request',text:'photo',attachments:[{receiptId:original}],uploadParts:[
  {type:'stream-file',id:original,name:'original.png',size:5,sha256,stream:async function*(){yield bytes}},
  {type:'stream-preview',previewFor:original,name:'entirely-different.png',mediaType:'image/png',stream:async function*(){yield Buffer.from('preview')}},
 ],recordAttachments:async pairs=>{events.push('bind');proof.push(...pairs)}},AbortSignal.timeout(3000))
 assert.deepEqual(events,['bind','prompt'])
 assert.deepEqual(proof,[{originalId:'sha256:'+sha256,originalIndex:0,previewIndex:1}])
 const unknown=[]
 await adapter.submit({conversationId:'chief',sessionId:'chat',requestId:'unlinked_request',text:'photo',attachments:[{receiptId:original}],uploadParts:[
  {type:'stream-file',name:'original.png',size:5,sha256,stream:async function*(){yield bytes}},
  {type:'stream-preview',name:'Model preview - original.png',mediaType:'image/png',stream:async function*(){yield Buffer.from('preview')}},
 ],recordAttachments:async pairs=>unknown.push(...pairs)},AbortSignal.timeout(3000))
 assert.deepEqual(unknown,[],'missing link identities must not accidentally match each other')
})

test('attachment-only history stays visible without synthesizing technical attachment text',async t=>{
 const {adapter}=await fixture(t)
 const cursor=Buffer.from(JSON.stringify({v:1,conversationId:'chief',sessionId:'chat',throughSeq:8,beforeSeq:8})).toString('base64url')
 const page=await adapter.history('chief',{cursor},AbortSignal.timeout(3000))
 assert.equal(page.messages.length,1);assert.equal(page.messages[0].text,'');assert.equal(page.messages[0].attachments.length,1)
})
test('a stored image in an invisible tool record never authorizes image bytes',async t=>{
 const {adapter,record,calls}=await fixture(t);record.event.type='tool/result'
 await assert.rejects(adapter.attachment(input,AbortSignal.timeout(3000)),{code:'PREVIEW_UNAVAILABLE'});assert.equal(calls.includes('read'),false)
})
