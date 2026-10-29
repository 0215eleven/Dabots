import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {generateKeyPairSync,randomBytes} from 'node:crypto'
import {WebSocket} from 'ws'
import {createMobileServer} from '../src/server.js'
import {BridgeError} from '../src/auth.js'
import {createRelayConnector} from '../src/relay-client.mjs'
import {createRelay} from '../../tools/relay/server.mjs'
import {createRelayTransport} from '../../../ios-app/sdk/relay-transport.js'
import {createBoxKeyPair} from '../../../ios-app/sdk/relay-crypto.js'
import {MobileClient,MemoryTokenStore} from '../../../ios-app/sdk/index.js'
const rng=n=>new Uint8Array(randomBytes(n))
test('physical relay preserves original Bridge tokens, sessions, receipts and Agent revocation',{timeout:15000},async t=>{
 const home=await mkdtemp(join(tmpdir(),'bridge-relay-e2e-'));let submitted=0,entered
 const assertGrant=(id,grant)=>{if(id.startsWith('agent:')&&!grant().agents)throw new BridgeError(403,'AGENT_ACCESS_REQUIRED','Not granted')}
 const adapter={capabilities:()=>({send:true,stream:true,agents:true}),state:async(_signal,grant)=>({agentAccess:grant().agents,session:'existing-session'}),target:async(id,signal,grant)=>{assertGrant(id,grant);if(id==='agent:slow'){entered?.();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}return {conversationId:id,sessionId:'existing-session'}},submit:async(payload,_signal,grant)=>{assertGrant(payload.conversationId,grant);submitted++;return {accepted:true}},async *follow(id,{after},signal,grant){assertGrant(id,grant);yield {type:'status',conversationId:id,status:'running',eventSeq:after??1};await new Promise(r=>{if(signal.aborted)r();else signal.addEventListener('abort',r,{once:true})})},dispose:async()=>{}}
 const server=await createMobileServer({home,adapter,config:{devAllowInsecure:true}})
 const secret=randomBytes(32).toString('base64url'),relay='wss://fixture.example';const middle=await createRelay({secret,origin:relay,port:0})
 class LocalSocket extends WebSocket{constructor(url){super(String(url).replace(relay,middle.url.replace('http:','ws:')))}}
 const x=createBoxKeyPair(rng),ed=generateKeyPairSync('ed25519');const connector=createRelayConnector({relay,secret,identity:{edPrivateKey:ed.privateKey,xPublicKey:x.publicKey,xSecretKey:x.secretKey},serverId:server.serverId,endpoint:id=>server.relayEndpoint(id),Socket:LocalSocket})
 const statuses=[];let transport,client,stream
 t.after(async()=>{stream?.close();client?.dispose();transport?.dispose();connector.close();await middle.close();await server.close();await rm(home,{recursive:true,force:true})})
 await connector.ready
 const direct=new MobileClient({baseUrl:server.url,allowInsecure:true,tokenStore:new MemoryTokenStore()});t.after(()=>direct.dispose())
 const qr=await server.operator('pairing.create');const claim=await direct.pair(qr.code,'Existing fixture phone');await server.operator('pairing.approve',{requestId:claim.requestId});const session=await direct.completePairing(claim.claimToken)
 const host=connector.status();transport=createRelayTransport({relay,computerId:host.computerId,computerKey:host.computerKey,serverId:server.serverId,randomBytes:rng,WebSocket:LocalSocket,onStatus:s=>statuses.push(s)})
 // Synthetic credential metadata migration only: prove server token itself remains valid.
 const store=new MemoryTokenStore({...session,serverUrl:transport.baseUrl,tlsPin:transport.tlsPin})
 client=new MobileClient({...transport,tokenStore:store,requestTimeoutMs:3000,reconnectDelayMs:20})
 assert.equal((await client.info()).serverId,server.serverId);assert.equal((await client.state()).session,'existing-session');assert(statuses.includes('ready'))
 assert.equal((await direct.state()).session,'existing-session')
 const submission={conversationId:'bot-existing',sessionId:'existing-session',requestId:'relay_stable_1',text:'hello'}
 assert.equal((await client.submit(submission)).accepted,true);assert.equal((await client.submit(submission)).accepted,true);assert.equal(submitted,1);assert.equal((await client.submission(submission.requestId)).status,'accepted')
 await assert.rejects(client.target('agent:existing'),{code:'AGENT_ACCESS_REQUIRED'})
 await server.operator('device.agents',{id:session.deviceId,enabled:true});assert.equal((await client.target('agent:existing')).sessionId,'existing-session')
 const streamStatus=[];const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Relay event timeout')),3000);stream=client.connect({conversationId:'agent:existing',onStatus:s=>streamStatus.push(s),onEvent:event=>{if(event.type==='status'){clearTimeout(timer);resolve()}},onError:reject})});await ready
 // Mid-flight revocation over the relay: the open Agent stream is dropped and a
 // request already waiting on the host is aborted with 403.
 const inside=new Promise(r=>{entered=r});const slow=assert.rejects(client.target('agent:slow'),{status:403,code:'AGENT_ACCESS_REQUIRED'});await inside
 await server.operator('device.agents',{id:session.deviceId,enabled:false})
 await slow
 for(let i=0;i<100&&!streamStatus.includes('reconnecting');i++)await new Promise(r=>setTimeout(r,20))
 assert(streamStatus.includes('reconnecting'),'the Agent stream was not closed by the revocation')
 await assert.rejects(client.target('agent:existing'),{code:'AGENT_ACCESS_REQUIRED'});stream.close()
 await server.operator('device.revoke',{id:session.deviceId});await assert.rejects(client.state(),{status:401})
})
