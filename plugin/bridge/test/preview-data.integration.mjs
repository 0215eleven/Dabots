// Actual public DSH, synthetic pixels and isolated loopback HTTP/encrypted relay. Not native device evidence.
import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {createRequire} from 'node:module'
import {resolve,join} from 'node:path'
import {WebSocket} from 'ws'
import {launchFixture} from './fixture-host.mjs'
import {createRelay} from '../../tools/relay/server.mjs'
import {portraitPng,portraitPixels} from '../../test-support/preview-images.mjs'
import {MobileClient,MemoryTokenStore} from '../../../ios-app/sdk/index.js'
import {createRelayTransport} from '../../../ios-app/sdk/relay-transport.js'
import {readPreview} from '../../../ios-app/src/ds/attachment-preview.ts'
let fixture,direct,client,relay,transport,passed=0
const check=label=>{passed++;console.log('PASS '+label)},hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const until=async task=>{let last;for(let n=0;n<150;n++){try{return await task()}catch(error){last=error;await new Promise(r=>setTimeout(r,100))}}throw last}
try{
 fixture=await launchFixture()
 const {bridgeUrl,operatorUrl,botId,groupId}=fixture.urls
 const operator=async(endpoint,payload={})=>{const response=await fetch(operatorUrl,{method:'POST',headers:{'x-fixture':'bridge-test-only'},body:JSON.stringify({endpoint,payload})});assert.equal(response.status,200);return response.json()}
 direct=new MobileClient({baseUrl:bridgeUrl,allowInsecure:true,tokenStore:new MemoryTokenStore()})
 const claim=await direct.pair((await operator('pairing.create')).code,'Synthetic preview phone');await operator('pairing.approve',{requestId:claim.requestId});const session=await direct.completePairing(claim.claimToken)
 const origin='wss://synthetic-preview-relay.example',secret=randomBytes(32).toString('base64url');relay=await createRelay({origin,secret,port:0})
 const host=await operator('test.relay-open',{origin,url:relay.url.replace('http:','ws:'),secret})
 class LocalSocket extends WebSocket{constructor(url){super(String(url).replace(origin,relay.url.replace('http:','ws:')))}}
 transport=createRelayTransport({relay:origin,computerId:host.computerId,computerKey:host.computerKey,serverId:session.serverId,randomBytes:n=>new Uint8Array(randomBytes(n)),WebSocket:LocalSocket})
 client=new MobileClient({...transport,tokenStore:new MemoryTokenStore({...session,serverUrl:transport.baseUrl,tlsPin:transport.tlsPin})})
 const deps=resolve(process.env.BRIDGE_TEST_DEPS??join(import.meta.dirname,'../fixture/deps/node_modules')),require=createRequire(join(deps,'../package.json')),sharp=require('sharp'),png=portraitPng(),raw=portraitPixels()
 const jpeg=await sharp(raw.pixels,{raw:{width:raw.width,height:raw.height,channels:4}}).withMetadata({orientation:6}).jpeg({quality:92}).toBuffer()
 assert.ok(png.length>200000&&png.length<2097152);assert.ok(jpeg.length>100000&&jpeg.length<2097152)
 const app=Buffer.alloc(60004);app[0]=255;app[1]=226;app.writeUInt16BE(60002,2)
 const largeExifJpeg=Buffer.concat([jpeg.subarray(0,2),app,app,jpeg.subarray(2)])
 for(const [label,bytes,mime,conversationId] of [['png',png,'image/png',botId],['jpeg',largeExifJpeg,'image/jpeg',groupId]]){
  const target=await direct.target(conversationId),source={size:bytes.length,read:async(offset,length)=>bytes.subarray(offset,offset+length)}
  const original=await direct.uploadFile({conversationId,sessionId:target.sessionId,clientId:'original_'+label,name:'synthetic.'+label,mediaType:mime,kind:'photo',...source})
  await direct.uploadFile({conversationId,sessionId:target.sessionId,clientId:'preview_'+label,name:'independent preview.'+label,mediaType:mime,kind:'preview',previewFor:original.receiptId,...source})
  await direct.submit({conversationId,sessionId:target.sessionId,requestId:'synthetic_preview_'+label,text:'Synthetic image fixture only',attachments:[original]})
  const row=await until(async()=>{const row=(await direct.messages(conversationId)).messages.find(m=>m.requestId==='synthetic_preview_'+label);assert.ok(row?.attachments[0]?.preview);return row})
  assert.equal(row.attachments.length,1);assert.equal(row.attachments[0].size,bytes.length)
  const attachmentId=row.attachments[0].preview.id,id='ds-preview-v1:'+encodeURIComponent(JSON.stringify([session.serverId,'synthetic-epoch',conversationId,target.sessionId,row.seq,attachmentId]))
  const output=[]
  for(const receiver of [direct,client]){
   const data=await readPreview(receiver,session.serverId,'synthetic-epoch',id,{current:()=>true}),received=Buffer.from(data.base64,'base64')
   assert.ok(received.length>100000&&received.length<=1048576);assert.ok(['image/png','image/jpeg','image/webp'].includes(data.mimeType));const meta=await sharp(received).metadata();assert.ok(meta.width>1&&meta.height>1&&Math.max(meta.width,meta.height)<=1536);output.push(hash(received))
  }
  assert.equal(output[0],output[1]);check(label+' substantive portrait pixels decode through real DSH, scoped plain SDK, direct and physical encrypted relay; one linked card')
  await assert.rejects(direct.attachmentData(conversationId,target.sessionId,attachmentId,{seq:row.seq+1000}),error=>error.status===404)
  await assert.rejects(client.attachmentData(conversationId,'foreign-session',attachmentId,{seq:row.seq}),error=>error.code==='SESSION_DENIED')
  check(label+' wrong message and cross-session reads are refused')
 }
 await operator('device.revoke',{id:session.deviceId})
 for(const receiver of [direct,client])await assert.rejects(receiver.attachmentData(botId,fixture.urls.sessionId,'sha256:'+'0'.repeat(64),{seq:0}),error=>error.status===401)
 check('revocation refuses both transports; no cached/private image survives a new authorized request')
 console.log(passed+' preview integration checks passed; public DSH '+fixture.dshVersion+'; no native device assertion')
}finally{direct?.dispose();client?.dispose();transport?.dispose();await relay?.close();await fixture?.close()}
