import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMobileServer} from '../src/server.js'
const id='sha256:'+'a'.repeat(64)
test('paired HTTPS carrier and encrypted relay endpoint share exact-message preview authorization',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ds-preview-http-'));let calls=0
 const adapter={capabilities:()=>({attachmentPreviews:1}),dispose:async()=>{},attachment:async scope=>{
  calls++;assert.deepEqual(scope,{conversationId:'chief',sessionId:'chat',seq:7,attachmentId:id});return {bytes:Buffer.from([1,2,3]),mediaType:'image/png'}
 }}
 const server=await createMobileServer({home,config:{devAllowInsecure:true},adapter});t.after(async()=>{await server.close();await rm(home,{recursive:true,force:true})})
 const post=async(path,body)=>(await fetch(server.url+'/mobile/v1/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json()
 const pairing=await server.operator('pairing.create'),claim=await post('pairings',{code:pairing.code,deviceName:'Synthetic preview reader'})
 await server.operator('pairing.approve',{requestId:claim.requestId});const session=await post('pairings/complete',{claimToken:claim.claimToken})
 const path='/mobile/v1/attachments/'+encodeURIComponent(id)+'?conversationId=chief&sessionId=chat&seq=7'
 assert.equal((await fetch(server.url+path)).status,401);assert.equal(calls,0)
 const response=await fetch(server.url+path,{headers:{authorization:'Bearer '+session.accessToken}})
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'image/png')
 assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3])
 const endpoint=server.relayEndpoint('synthetic-preview'),relayed=await endpoint.request({method:'GET',path,headers:{authorization:'Bearer '+session.accessToken}})
 assert.equal(relayed.status,200);assert.deepEqual([...relayed.body],[1,2,3])
 await server.operator('device.revoke',{id:session.deviceId})
 assert.equal((await endpoint.request({method:'GET',path,headers:{authorization:'Bearer '+session.accessToken}})).status,401);assert.equal(calls,2)
})

test('preview concurrency is bounded and revocation during a read never releases bytes',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ds-preview-quota-')),gates=[]
 const server=await createMobileServer({home,config:{devAllowInsecure:true},adapter:{capabilities:()=>({attachmentPreviews:1}),dispose:async()=>{},attachment:async()=>new Promise(resolve=>gates.push(()=>resolve({bytes:Buffer.from([1]),mediaType:'image/png'})))}})
 t.after(async()=>{gates.forEach(release=>release());await server.close();await rm(home,{recursive:true,force:true})})
 const endpoint=server.relayEndpoint('synthetic-quota'),post=async(path,body)=>(await endpoint.request({method:'POST',path:'/mobile/v1/'+path,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(body))})).body
 const devices=[]
 for(let i=0;i<3;i++){
  const pairing=await server.operator('pairing.create'),claim=JSON.parse(new TextDecoder().decode(await post('pairings',{code:pairing.code,deviceName:'Synthetic '+i})))
  await server.operator('pairing.approve',{requestId:claim.requestId});devices.push(JSON.parse(new TextDecoder().decode(await post('pairings/complete',{claimToken:claim.claimToken}))))
 }
 const request=device=>endpoint.request({method:'GET',path:'/mobile/v1/attachments/'+encodeURIComponent(id)+'?conversationId=chief&sessionId=chat&seq=7',headers:{authorization:'Bearer '+device.accessToken}})
 const wait=async count=>{for(let i=0;i<100&&gates.length<count;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(gates.length,count)}
 const a=request(devices[0]),b=request(devices[0]);await wait(2)
 assert.equal((await request(devices[0])).status,429)
 const c=request(devices[1]),d=request(devices[1]);await wait(4)
 assert.equal((await request(devices[2])).status,429)
 await server.operator('device.revoke',{id:devices[0].deviceId});gates.splice(0).forEach(release=>release())
 const replies=await Promise.all([a,b,c,d]);assert.deepEqual(replies.map(r=>r.status),[401,401,200,200])
 const next=request(devices[2]);await wait(1);gates.pop()();assert.equal((await next).status,200)
})

test('malformed scopes and unsafe adapter responses fail closed',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ds-preview-limits-'));let calls=0,result={bytes:Buffer.alloc(1048577),mediaType:'image/png'}
 const server=await createMobileServer({home,config:{devAllowInsecure:true},adapter:{capabilities:()=>({attachmentPreviews:1}),dispose:async()=>{},attachment:async()=>{calls++;return result}}})
 t.after(async()=>{await server.close();await rm(home,{recursive:true,force:true})})
 const post=async(path,body)=>(await fetch(server.url+'/mobile/v1/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json()
 const pairing=await server.operator('pairing.create'),claim=await post('pairings',{code:pairing.code,deviceName:'Synthetic limits'})
 await server.operator('pairing.approve',{requestId:claim.requestId});const device=await post('pairings/complete',{claimToken:claim.claimToken}),headers={authorization:'Bearer '+device.accessToken}
 const path='/mobile/v1/attachments/'+encodeURIComponent(id)+'?conversationId=chief&sessionId=chat&seq='
 for(const seq of ['-1','1.5','9007199254740992',''])assert.equal((await fetch(server.url+path+seq,{headers})).status,400)
 assert.equal(calls,0);assert.equal((await fetch(server.url+path+'7',{headers})).status,503)
 result={bytes:Buffer.from('html'),mediaType:'text/html'};assert.equal((await fetch(server.url+path+'7',{headers})).status,503)
})

test('trusted display links survive an actual Bridge/auth-store restart',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ds-preview-restart-'));let server,requestId
 const adapter={capabilities:()=>({send:true}),dispose:async()=>{},submit:async input=>{requestId=input.requestId;await input.recordAttachments([{originalId:id,originalIndex:0,previewIndex:1}]);return {accepted:true}},history:async()=>({messages:[{role:'user',requestId,sessionId:'chat',seq:7,text:'photo',attachments:[{id,type:'file',name:'original.png',size:100000000},{id,type:'image',name:'independent-name.png',size:70,mediaType:'image/png',width:1,height:1,previewAvailable:true}]}]})}
 t.after(async()=>{await server?.close();await rm(home,{recursive:true,force:true})})
 server=await createMobileServer({home,config:{devAllowInsecure:true},adapter})
 const post=async(path,body,headers={})=>(await fetch(server.url+'/mobile/v1/'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})).json()
 const pairing=await server.operator('pairing.create'),claim=await post('pairings',{code:pairing.code,deviceName:'Synthetic restart'})
 await server.operator('pairing.approve',{requestId:claim.requestId});const device=await post('pairings/complete',{claimToken:claim.claimToken}),headers={authorization:'Bearer '+device.accessToken}
 const receipt=await post('submissions',{conversationId:'chief',sessionId:'chat',requestId:'photo_request_with_underscores',text:'photo'},headers)
 assert.equal(receipt.status,'accepted');await server.close()
 server=await createMobileServer({home,config:{devAllowInsecure:true},adapter})
 const response=await fetch(server.url+'/mobile/v1/conversations/chief/messages',{headers}),history=await response.json()
 assert.equal(response.status,200);assert.equal(history.messages[0].attachments.length,1);assert.equal(history.messages[0].attachments[0].size,100000000);assert.equal(history.messages[0].attachments[0].preview.id,id)
})
