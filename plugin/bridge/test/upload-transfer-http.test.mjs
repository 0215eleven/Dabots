import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm,readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createMobileServer } from '../src/server.js'
import { MobileClient,MemoryTokenStore } from '../../../ios-app/sdk/index.js'
const sha=data=>createHash('sha256').update(data).digest('hex')
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'dabots-transfer-http-'));let sessionId='s';const received=[]
 const adapter={capabilities:()=>({attachments:true,uploadTransfers:1,send:true}),target:async(conversationId,_signal,grant)=>{const kind=conversationId==='agent'?'agent':'bot';if(kind==='agent'&&!grant().agents)throw Object.assign(Error('Agent access required'),{status:403,code:'AGENT_ACCESS_REQUIRED'});return{conversationId,sessionId,kind}},dispose:async()=>{},
  submit:async({uploadParts,requestId,sessionId})=>{for(const file of uploadParts){let text='';for await(const chunk of file.stream())text+=chunk;received.push(text)}return {accepted:true,sessionId,requestId}}}
 const server=await createMobileServer({home,config:{port:0,devAllowInsecure:true},adapter})
 t.after(async()=>{await server.close();await rm(home,{recursive:true,force:true})})
 const clients=[]
 async function pair(){const client=new MobileClient({baseUrl:server.url,allowInsecure:true,tokenStore:new MemoryTokenStore()});clients.push(client)
  const claim=await client.pair((await server.operator('pairing.create')).code,'Synthetic transfer test');await server.operator('pairing.approve',{requestId:claim.requestId});return {client,session:await client.completePairing(claim.claimToken)}}
 t.after(()=>clients.forEach(client=>client.dispose()))
 const phone=await pair()
 async function api(path,{method='GET',body,raw,token=phone.session.accessToken}={}){const init={method,headers:{...(token?{authorization:`Bearer ${token}`} :{}),'content-type':raw?'application/octet-stream':'application/json'}};if(method!=='GET'&&method!=='HEAD')init.body=raw??(body===undefined?undefined:JSON.stringify(body));const response=await fetch(`${server.url}/mobile/v1/${path}`,init);return {status:response.status,value:await response.json()}}
 return {home,server,phone,pair,api,received,move:()=>{sessionId='next'}}
}
const input={clientId:'one',conversationId:'bot',sessionId:'s',name:'a.txt',mediaType:'text/plain',size:3,kind:'file'}
test('versioned chunk route binds receipts to devices and immutable sessions and feeds streams to admission',async t=>{
 const f=await fixture(t),started=await f.api('upload-transfers',{method:'POST',body:input});assert.equal(started.status,200)
 const id=started.value.id
 assert.equal((await f.api(`upload-transfers/${id}`,{method:'PUT',raw:Buffer.from('abc')})).status,200)
 assert.equal((await f.api(`upload-transfers/${id}/complete`,{method:'POST',body:{sha256:sha('abc')}})).status,200)
 const other=await f.pair();assert.equal((await f.api(`upload-transfers/${id}`,{token:other.session.accessToken})).status,409)
 const accepted=await f.phone.client.submit({conversationId:'bot',sessionId:'s',requestId:'stream_message',text:'',attachments:[{receiptId:id}]})
 assert.equal(accepted.accepted,true);assert.deepEqual(f.received,['abc'])
 assert.equal((await f.api(`upload-transfers/${id}`)).status,409)
})
test('stale sessions, excessive chunks and revoked authorization never publish a file',async t=>{
 const f=await fixture(t),{value}=await f.api('upload-transfers',{method:'POST',body:input});assert.ok(value.id)
 assert.equal((await f.api(`upload-transfers/${value.id}?offset=0`,{method:'PUT',raw:Buffer.alloc(262145)})).status,413)
 f.move();assert.equal((await f.api(`upload-transfers/${value.id}?offset=0`,{method:'PUT',raw:Buffer.from('abc')})).status,409)
 assert.deepEqual(await readdir(join(f.home,'upload-transfers')),[])
 await f.server.operator('device.revoke',{id:f.phone.session.deviceId})
 assert.equal((await f.api('upload-transfers',{method:'POST',body:{...input,sessionId:'next'}})).status,401)
 assert.deepEqual(f.received,[])
})
test('bounded chunk traffic has its own authenticated rate budget and cannot exhaust normal chat requests',async t=>{
 const f=await fixture(t),{value}=await f.api('upload-transfers',{method:'POST',body:{...input,size:601}})
 for(let offset=0;offset<601;offset++)assert.equal((await f.api(`upload-transfers/${value.id}?offset=${offset}`,{method:'PUT',raw:Buffer.from('a')})).status,200)
 assert.equal((await f.api('devices')).status,200)
})

test('revoking a device purges its active on-disk upload and cannot resume it',async t=>{
 const f=await fixture(t),{value}=await f.api('upload-transfers',{method:'POST',body:input})
 assert.equal((await f.api(`upload-transfers/${value.id}?offset=0`,{method:'PUT',raw:Buffer.from('a')})).status,200)
 assert.equal((await readdir(join(f.home,'upload-transfers'))).length,1)
 await f.server.operator('device.revoke',{id:f.phone.session.deviceId})
 for(let n=0;n<50&&(await readdir(join(f.home,'upload-transfers'))).length;n++)await new Promise(resolve=>setTimeout(resolve,10))
 assert.deepEqual(await readdir(join(f.home,'upload-transfers')),[])
 assert.equal((await f.api(`upload-transfers/${value.id}`)).status,401)
})

test('removing Agent access purges Agent staging while retaining an unrelated Bot receipt',async t=>{
 const f=await fixture(t)
 await f.server.operator('device.agents',{id:f.phone.session.deviceId,enabled:true})
 const bot=(await f.api('upload-transfers',{method:'POST',body:input})).value
 await f.api(`upload-transfers/${bot.id}`,{method:'PUT',raw:Buffer.from('abc')});await f.api(`upload-transfers/${bot.id}/complete`,{method:'POST',body:{sha256:sha('abc')}})
 const agent=(await f.api('upload-transfers',{method:'POST',body:{...input,clientId:'agent',conversationId:'agent'}})).value;assert.ok(agent.id)
 await f.server.operator('device.agents',{id:f.phone.session.deviceId,enabled:false})
 for(let n=0;n<50&&(await readdir(join(f.home,'upload-transfers'))).length>1;n++)await new Promise(resolve=>setTimeout(resolve,10))
 assert.deepEqual(await readdir(join(f.home,'upload-transfers')),[bot.id]);assert.equal((await f.api(`upload-transfers/${bot.id}`)).status,200)
 await f.server.operator('device.agents',{id:f.phone.session.deviceId,enabled:true})
 assert.equal((await f.api(`upload-transfers/${agent.id}`)).status,409)
})
