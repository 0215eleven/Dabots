// Synthetic bytes and isolated public DSH only. No live profile, personal file or external model.
import assert from 'node:assert/strict'
import {createHash,randomBytes,X509Certificate} from 'node:crypto'
import {createServer,request as tlsRequest} from 'node:https'
import {request as httpRequest} from 'node:http'
import {checkServerIdentity} from 'node:tls'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {crc32,deflateSync} from 'node:zlib'
import {WebSocket} from 'ws'
import {launchFixture} from './fixture-host.mjs'
import {createRelay} from '../../tools/relay/server.mjs'
import {createRelayTransport} from '../../../ios-app/sdk/relay-transport.js'
import {MobileClient,MemoryTokenStore} from '../../../ios-app/sdk/index.js'

let fixture,tls,relay,transport,client,direct;let passed=0
const until=async task=>{const deadline=Date.now()+30000;let error;while(Date.now()<deadline){try{return await task()}catch(cause){error=cause;await new Promise(resolve=>setTimeout(resolve,60))}}throw error}
const check=name=>{passed++;console.log('PASS '+name)}
const hashOf=bytes=>createHash('sha256').update(bytes).digest('hex')
function pngChunk(type,data){const kind=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([length,kind,data,crc])}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6
const tinyPng=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(Buffer.from([0,12,34,56,255]))),pngChunk('IEND',Buffer.alloc(0))])
function originalPng(size){
 const prefix=tinyPng.subarray(0,-12),keyword=Buffer.from('synthetic\0'),dataLength=size-tinyPng.length-12,length=Buffer.alloc(4);length.writeUInt32BE(dataLength)
 const head=Buffer.concat([prefix,length,Buffer.from('tEXt'),keyword]),fill=dataLength-keyword.length;let crc=crc32(Buffer.concat([Buffer.from('tEXt'),keyword]));const block=Buffer.alloc(262144,120)
 for(let offset=0;offset<fill;offset+=block.length)crc=crc32(block.subarray(0,Math.min(block.length,fill-offset)),crc)
 const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc);const tail=Buffer.concat([checksum,tinyPng.subarray(-12)])
 return (offset,count)=>{const bytes=Buffer.alloc(count,120);if(offset<head.length)head.copy(bytes,0,offset,Math.min(head.length,offset+count));const start=Math.max(offset,size-tail.length);if(start<offset+count)tail.copy(bytes,start-offset,start-(size-tail.length));return bytes}
}
try{
 fixture=await launchFixture()
 const {bridgeUrl,operatorUrl,botId,sessionId}=fixture.urls
 const operator=async(endpoint,payload={})=>{const response=await fetch(operatorUrl,{method:'POST',headers:{'x-fixture':'bridge-test-only'},body:JSON.stringify({endpoint,payload})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value}
 // The HTTPS adapter validates both the test CA and SPKI pin, and never accepts a whole file body.
 const openssl=process.env.TEST_OPENSSL??(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl')
 const certPath=join(fixture.home,'synthetic-cert.pem'),keyPath=join(fixture.home,'synthetic-key.pem')
 const generated=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{encoding:'utf8',windowsHide:true})
 assert.equal(generated.status,0,'Unable to generate isolated test certificate')
 const cert=await readFile(certPath),pin=hashOf(new X509Certificate(cert).publicKey.export({format:'der',type:'spki'}))
 tls=createServer({cert,key:await readFile(keyPath)},(incoming,response)=>{
  const upstream=httpRequest(new URL(incoming.url,bridgeUrl),{method:incoming.method,headers:incoming.headers},result=>{response.writeHead(result.statusCode,result.headers);result.pipe(response)})
  upstream.on('error',()=>{response.destroy()});incoming.on('aborted',()=>upstream.destroy());incoming.pipe(upstream)
 });await new Promise(resolve=>tls.listen(0,'127.0.0.1',resolve))
 const baseUrl=`https://127.0.0.1:${tls.address().port}`
 const pinnedFetch=(input,init={})=>new Promise((resolve,reject)=>{
  const body=init.body;assert.ok(body==null||Buffer.byteLength(body)<=524288,'transport received an unbounded body')
  const request=tlsRequest(input,{method:init.method??'GET',headers:init.headers,ca:cert,signal:init.signal,
   checkServerIdentity:(hostname,peer)=>checkServerIdentity(hostname,peer)??(hashOf(new X509Certificate(peer.raw).publicKey.export({format:'der',type:'spki'}))===pin?undefined:Error('Pin mismatch')),
  },response=>{const chunks=[];let length=0;response.on('data',chunk=>{length+=chunk.length;if(length>1048576){request.destroy(Error('Response too large'));return}chunks.push(chunk)});response.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:response.statusCode,ok:response.statusCode>=200&&response.statusCode<300,headers:new Headers(response.headers),json:async()=>JSON.parse(text),blob:async()=>new Blob([Buffer.concat(chunks)],{type:response.headers['content-type']??'application/octet-stream'})})})})
  request.on('error',reject);if(body!=null)request.write(body);request.end()
 })
 class NoSocket{constructor(){throw Error('Upload test does not use direct event sockets')}}
 const tokens=new MemoryTokenStore();direct=new MobileClient({baseUrl,tlsPin:'sha256:'+pin,fetch:pinnedFetch,WebSocket:NoSocket,tokenStore:tokens})
 assert.equal((await direct.info()).capabilities.uploadTransfers,1)
 assert.equal((await direct.info()).capabilities.attachmentPreviews,1)
 const claim=await direct.pair((await operator('pairing.create')).code,'Synthetic large-upload phone');await operator('pairing.approve',{requestId:claim.requestId});const session=await direct.completePairing(claim.claimToken)
 async function roundTrip(receiver,label,seed,onProgress,photo=false){
  const size=100000000,expected=createHash('sha256');let maxRead=0,reads=0
  const photoRead=photo?originalPng(size):null
  const file=await receiver.uploadFile({conversationId:botId,sessionId,clientId:'large_'+label,name:'synthetic-'+label+(photo?'.png':'.txt'),mediaType:photo?'image/png':'text/plain',size,kind:photo?'photo':'file',
   read:async(offset,length)=>{maxRead=Math.max(maxRead,length);reads++;const data=photoRead?photoRead(offset,length):new Uint8Array(length).fill((offset+seed)%251);expected.update(data);return data},onProgress})
  assert.equal(file.size,size);assert.ok(reads>300);assert.ok(maxRead<=262144);const expectedSha=expected.digest('hex');assert.equal(file.sha256,expectedSha)
  const message={conversationId:botId,sessionId,requestId:'large_'+label,text:'Synthetic original-file intake',attachments:[file]}
  assert.equal((await receiver.submit(message)).accepted,true)
  assert.deepEqual(await receiver.submit(message),await receiver.submission(message.requestId),'stable retry must not admit again')
  const stored=await operator('test.file-facts',{sha256:expectedSha,name:file.name,size});assert.equal(stored.bytes,size);assert.equal(stored.sha256,expectedSha);assert.ok(stored.maxChunk<=65536)
  check(label+' 100 MB original preserved through actual DSH streaming storage; SHA-256 and stable receipt verified')
 }
 await roundTrip(direct,'https',17)
 const secret=randomBytes(32).toString('base64url'),origin='wss://synthetic-relay.example'
 relay=await createRelay({secret,origin,port:0})
 const host=await operator('test.relay-open',{origin,url:relay.url.replace('http:','ws:'),secret})
 const sockets=[];class LocalSocket extends WebSocket{constructor(url){super(String(url).replace(origin,relay.url.replace('http:','ws:')));sockets.push(this)}}
 transport=createRelayTransport({relay:origin,computerId:host.computerId,computerKey:host.computerKey,serverId:session.serverId,randomBytes:n=>new Uint8Array(randomBytes(n)),WebSocket:LocalSocket})
 client=new MobileClient({...transport,tokenStore:new MemoryTokenStore({...session,serverUrl:transport.baseUrl,tlsPin:transport.tlsPin}),requestTimeoutMs:10000})
 assert.equal((await client.info()).capabilities.uploadTransfers,1)
 let interrupted=false
 await roundTrip(client,'encrypted-relay',31,bytes=>{if(bytes>=1048576&&!interrupted){interrupted=true;sockets.at(-1).terminate()}})
 assert.equal(interrupted,true);assert.ok(sockets.length>=2,'physical encrypted stream must reconnect')
 check('mid-transfer physical relay disconnect resumed without changing original bytes')
 await roundTrip(direct,'original-photo',0,undefined,true)
 await operator('device.agents',{id:session.deviceId,enabled:true})
 const agent=await direct.action('agent-open',{})
 const visiblePreviews=[]
 for(const [label,conversationId] of [['bot',botId],['group',fixture.urls.groupId],['agent',agent.conversationId]]){
  const target=await direct.target(conversationId),source={size:tinyPng.length,read:async(offset,length)=>new Uint8Array(tinyPng.subarray(offset,offset+length))}
  const original=await direct.uploadFile({conversationId,sessionId:target.sessionId,clientId:'photo_'+label,name:'original-'+label+'.png',mediaType:'image/png',kind:'photo',...source})
  await direct.uploadFile({conversationId,sessionId:target.sessionId,clientId:'preview_'+label,name:'Model preview - '+label+'.png',mediaType:'image/png',kind:'preview',previewFor:original.receiptId,...source})
  assert.equal((await direct.submit({conversationId,sessionId:target.sessionId,requestId:'preview_'+label,text:'Original file and independent model preview',attachments:[original]})).accepted,true)
  check(label+' original-file receipt and separate model image use real exact-session DSH admission')
  const row=await until(async()=>{const value=(await direct.messages(conversationId)).messages.find(row=>row.requestId==='preview_'+label);assert.ok(value);return value})
  assert.equal(row.attachments.length,1);assert.equal(row.attachments[0].size,tinyPng.length);assert.ok(row.attachments[0].preview)
  const attachmentId=row.attachments[0].preview.id,blob=await direct.attachment(conversationId,target.sessionId,attachmentId,{seq:row.seq})
  assert.ok(blob.size>0&&blob.size<=1048576);assert.ok(['image/png','image/jpeg','image/webp'].includes(blob.type))
  visiblePreviews.push({conversationId,sessionId:target.sessionId,attachmentId,seq:row.seq})
  check(label+' original/preview proof yields one photo and an exact-message bounded real DSH preview')
  if(label==='bot'){
   const encrypted=await client.attachment(conversationId,target.sessionId,attachmentId,{seq:row.seq})
   assert.equal(hashOf(new Uint8Array(await encrypted.arrayBuffer())),hashOf(new Uint8Array(await blob.arrayBuffer())))
   check('physical encrypted relay returns the same authorized preview bytes as direct HTTPS')
   await assert.rejects(direct.attachment(conversationId,fixture.urls.groupId,attachmentId,{seq:row.seq}),error=>error.code==='SESSION_DENIED')
   check('foreign Session cannot reuse an otherwise valid preview hash/message')
  }
  const bytes=Buffer.from('synthetic ordinary document '+label)
  const document=await direct.uploadFile({conversationId,sessionId:target.sessionId,clientId:'document_'+label,name:'synthetic-'+label+'.txt',mediaType:'text/plain',kind:'file',size:bytes.length,read:async(offset,length)=>bytes.subarray(offset,offset+length)})
  assert.equal((await direct.submit({conversationId,sessionId:target.sessionId,requestId:'document_'+label,text:'Synthetic ordinary document',attachments:[document]})).accepted,true)
  check(label+' ordinary file reaches the real DSH Session')
 }
 const foreign=await operator('test.file-receipt',{sessionId})
 const response=await fetch(operatorUrl,{method:'POST',headers:{'x-fixture':'bridge-test-only'},body:JSON.stringify({endpoint:'test.bot-call',payload:{action:'bridge.submit',body:{version:2,requestId:'foreign_receipt',conversationId:fixture.urls.groupId,expectedSessionId:fixture.urls.groupId,expectedMembers:fixture.urls.memberIds,content:[{type:'file',receiptId:foreign.receiptId}]}}})})
 assert.equal(response.ok,false);assert.equal((await response.json()).code,'bot/invalid')
 check('real DSH file receipt from another Session is refused before prompt admission')
 const agentPreview=visiblePreviews[2],botPreview=visiblePreviews[0]
 await operator('device.agents',{id:session.deviceId,enabled:false})
 await assert.rejects(direct.attachment(agentPreview.conversationId,agentPreview.sessionId,agentPreview.attachmentId,{seq:agentPreview.seq}),error=>error.code==='CONVERSATION_NOT_FOUND')
 assert.ok((await direct.attachment(botPreview.conversationId,botPreview.sessionId,botPreview.attachmentId,{seq:botPreview.seq})).size>0)
 check('Agent revocation blocks its images while preserving authorized Bot previews')
 await operator('device.revoke',{id:session.deviceId})
 for(const receiver of [direct,client])await assert.rejects(receiver.attachment(botPreview.conversationId,botPreview.sessionId,botPreview.attachmentId,{seq:botPreview.seq}),error=>error.status===401)
 check('device revocation blocks preview reads through HTTPS and physical encrypted relay')
 console.log(passed+' large upload integration checks passed; public DSH '+fixture.dshVersion+'; no native iOS/device assertion')
}catch(error){if(fixture)console.error(fixture.diagnostics().replace(/([?&]token=)[^\s&]+/gu,'$1[synthetic-token-redacted]'));throw error}
finally{client?.dispose();direct?.dispose();transport?.dispose();await relay?.close();if(tls){tls.closeAllConnections();await new Promise(resolve=>tls.close(resolve))}await fixture?.close()}
