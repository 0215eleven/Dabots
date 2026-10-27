import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
import {WebSocket} from 'ws'
import {createMobileServer} from '../src/server.js'
import {createRelaySettings,validateRelayUrl} from '../src/relay-settings.mjs'
import {createRelay} from '../../relay/server.mjs'
import {createRelayTransport} from '../../packages/mobile-sdk/relay-transport.js'
import {MobileClient,MemoryTokenStore} from '../../packages/mobile-sdk/index.js'

const rng=n=>new Uint8Array(randomBytes(n)),relayOrigin='wss://relay.example'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
async function until(check,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(20)}throw Error('Timed out')}
const adapter=(extra={})=>({capabilities:()=>({send:true,stream:true,agents:true}),state:async()=>({session:'existing-session'}),target:async id=>({conversationId:id,sessionId:'existing-session'}),submit:async()=>({accepted:true}),async *follow(){},dispose:async()=>{},...extra})
async function fixture(t,{port=0}={}){
  const home=await mkdtemp(join(tmpdir(),'bridge-relay-settings-')),secret=randomBytes(32).toString('base64url')
  const server=await createMobileServer({home,adapter:adapter(),config:{devAllowInsecure:true}})
  let middle=await createRelay({secret,origin:relayOrigin,port})
  const target=()=>middle.url.replace('http:','ws:')
  class LocalSocket extends WebSocket{constructor(url){super(String(url).replace(relayOrigin,target()))}}
  const settings=await createRelaySettings({home,server,Socket:LocalSocket})
  const value={home,secret,server,settings,LocalSocket,get middle(){return middle},async restartRelay(){const {port}=new URL(middle.url);await middle.close();middle=await createRelay({secret,origin:relayOrigin,port:Number(port)})}}
  t.after(async()=>{await value.settings.dispose();await middle.close();await value.server.close();await rm(home,{recursive:true,force:true})})
  return value
}

test('relay addresses must be bare wss origins',()=>{
  assert.equal(validateRelayUrl('wss://relay.example.com'),'wss://relay.example.com')
  for(const bad of ['https://relay.example.com','wss://user:pw@relay.example.com','wss://relay.example.com/path','wss://relay.example.com?x=1','ws://relay.example.com'])assert.throws(()=>validateRelayUrl(bad),{code:'INVALID_RELAY_URL'})
})

test('settings persist owner-only, never echo the secret and keep one computer identity',async t=>{
  const f=await fixture(t)
  assert.deepEqual(f.settings.snapshot(),{mode:'direct',relay:null,secretSet:false,state:'disabled',computerId:null,ready:false,revision:0})
  await assert.rejects(f.settings.select({mode:'relay'}),{code:'RELAY_NOT_CONFIGURED'})
  await assert.rejects(f.settings.configure({relay:relayOrigin,secret:'short'}),{code:'INVALID_RELAY_SECRET'})
  await assert.rejects(f.settings.configure({relay:relayOrigin}),{code:'RELAY_SECRET_REQUIRED'})
  await f.settings.configure({relay:relayOrigin,secret:f.secret})
  assert.equal(f.settings.pairing(),null,'direct mode keeps the direct pairing code')
  await f.settings.select({mode:'relay'})
  await until(()=>f.settings.snapshot().ready)
  const status=JSON.stringify(f.settings.snapshot())
  assert.equal(status.includes(f.secret),false)
  for(const name of ['relay-connection.json','relay-identity.json']){
    const info=await stat(join(f.home,name))
    assert.equal(info.isFile(),true)
    // POSIX mode bits do not describe Windows ACLs. All other checks still run.
    if(process.platform!=='win32')assert.equal(info.mode&0o777,0o600)
  }
  if(process.platform==='win32')t.diagnostic('POSIX 0600 assertion not applicable on win32; Windows ACLs are not validated by this fixture.')
  const identity=await readFile(join(f.home,'relay-identity.json'),'utf8')
  const first=f.settings.snapshot().computerId
  // Saving the address again without a secret keeps the stored one.
  await f.settings.configure({relay:relayOrigin})
  await until(()=>f.settings.snapshot().ready)
  assert.equal(f.settings.snapshot().computerId,first)
  await f.settings.dispose()
  f.settings=await createRelaySettings({home:f.home,server:f.server,Socket:f.LocalSocket})
  await until(()=>f.settings.snapshot().ready)
  assert.equal(f.settings.snapshot().computerId,first,'restarts reuse the saved identity')
  assert.equal(await readFile(join(f.home,'relay-identity.json'),'utf8'),identity)
})

test('relay pairing, mode switching, relay restart and cancellation keep one device and one write',{timeout:30000},async t=>{
  let writes=0,release
  const f=await fixture(t)
  await f.server.close()
  f.server=await createMobileServer({home:f.home,adapter:adapter({submit:async(payload,signal)=>{writes++;if(payload.text==='slow')await new Promise((resolve,reject)=>{release=resolve;signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true})});return {accepted:true}}}),config:{devAllowInsecure:true}})
  await f.settings.dispose()
  f.settings=await createRelaySettings({home:f.home,server:f.server,Socket:f.LocalSocket})
  await f.settings.configure({relay:relayOrigin,secret:f.secret})
  await f.settings.select({mode:'relay'})
  await until(()=>f.settings.snapshot().ready)
  const qr=f.settings.pairing()
  assert.deepEqual(Object.keys(qr).sort(),['code','computerId','computerKey','expiresAt','relay','serverId','v'])
  assert.equal(JSON.stringify(qr).includes(f.secret),false)
  const transport=createRelayTransport({relay:qr.relay,computerId:qr.computerId,computerKey:qr.computerKey,serverId:qr.serverId,randomBytes:rng,WebSocket:f.LocalSocket})
  const client=new MobileClient({baseUrl:transport.baseUrl,fetch:transport.fetch,WebSocket:transport.WebSocket,tokenStore:new MemoryTokenStore(),requestTimeoutMs:5000})
  t.after(()=>{client.dispose();transport.dispose()})
  assert.equal((await client.info()).serverId,qr.serverId)
  const claim=await client.pair(qr.code,'Relay phone')
  await f.server.operator('pairing.approve',{requestId:claim.requestId})
  const session=await client.completePairing(claim.claimToken)
  assert.equal((await client.state()).session,'existing-session')

  const stale=f.settings.pairing()
  await f.settings.select({mode:'direct'})
  await assert.rejects(client.state())
  const direct=new MobileClient({baseUrl:f.server.url,allowInsecure:true,tokenStore:new MemoryTokenStore({...session,serverUrl:f.server.url})})
  t.after(()=>direct.dispose())
  assert.equal((await direct.state()).session,'existing-session','the same device token works on the direct door')
  await assert.rejects(direct.pair(stale.code,'Late phone'),{code:'INVALID_PAIRING_CODE'})
  await f.settings.select({mode:'relay'})
  await until(()=>f.settings.snapshot().ready)
  assert.equal((await client.state()).session,'existing-session','switching back needs no new pairing')

  const before=f.settings.snapshot().revision
  await f.restartRelay()
  await until(()=>f.settings.snapshot().revision>before+1&&f.settings.snapshot().ready,10000)
  assert.equal((await client.state()).session,'existing-session','reconnects after the relay restarts')

  // Cancel mid-flight through the relay: the Bridge aborts the host call and a
  // retry with the same requestId is reconciled, never submitted again.
  const controller=new AbortController(),message={conversationId:'bot-1',sessionId:'existing-session',requestId:'relay_cancel_1',text:'slow'}
  const token=(await client.tokenStore?.get?.())?.accessToken??session.accessToken
  const pending=transport.fetch(`${transport.baseUrl}/mobile/v1/submissions`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(message),signal:controller.signal})
  await until(()=>release)
  controller.abort()
  await assert.rejects(pending)
  const retried=await client.submit(message)
  assert.equal(retried.status,'unknown')
  assert.equal(writes,1,'a cancelled request is not written twice on retry')
  assert.equal(JSON.stringify((await f.server.operator('status')).devices).includes('Relay phone'),true)
  assert.equal((await f.server.operator('status')).devices.filter(d=>!d.revokedAt).length,1)
})
