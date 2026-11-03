import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,createHash,sign,randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import WebSocket from 'ws'
import {createRelay} from '../server.mjs'
import {adminMessage,createApprovals} from '../approvals.mjs'

const origin='wss://fixture.example'
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'relay-approvals-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const file=join(dir,'approvals.json'),bootstrapFile=join(dir,'admin-bootstrap-code')
  const approvals=await createApprovals({file,bootstrapFile})
  const relay=await createRelay({origin,port:0,openRegistration:true,approvals})
  t.after(()=>relay.close())
  return {relay,approvals,file,bootstrapFile,code:async()=>(await readFile(bootstrapFile,'utf8')).trim()}
}
// An admin phone: an Ed25519 key that signs every request.
function phone(relay){
  const keys=generateKeyPairSync('ed25519'),key=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url')
  const call=async(method,path,body,{time=Date.now(),reuse}={})=>{
    const text=body?JSON.stringify(body):''
    const signature=reuse??sign(null,Buffer.from(adminMessage({origin,method,path,time,body:Buffer.from(text)})),keys.privateKey).toString('base64url')
    const response=await fetch(relay.url+path,{method,headers:{'content-type':'application/json','x-dabots-admin-key':key,'x-dabots-admin-time':String(time),'x-dabots-admin-signature':signature},body:text||undefined})
    return {status:response.status,body:await response.json(),signature,time}
  }
  return {key,call}
}
function computer(relay,name){
  const keys=generateKeyPairSync('ed25519')
  const edPublicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url'),computerKey=randomBytes(32).toString('base64url')
  const computerId=createHash('sha256').update(Buffer.from(edPublicKey,'base64url')).digest().subarray(0,16).toString('base64url')
  const register=async()=>{
    const ws=new WebSocket(relay.url.replace('http','ws')+'/v1/computer')
    const [challenge]=await once(ws,'message');const {nonce}=JSON.parse(challenge)
    ws.send(JSON.stringify({type:'register',nonce,computerId,edPublicKey,computerKey,name,signature:sign(null,Buffer.from(JSON.stringify(['ds-bot-computer-v2',origin,nonce,computerId,edPublicKey,computerKey])),keys.privateKey).toString('base64url')}))
    return new Promise(resolve=>{ws.once('message',data=>resolve({ws,reply:JSON.parse(data)}));ws.once('close',code=>resolve({ws,code}))})
  }
  return {computerId,register}
}

test('an unapproved computer waits; the admin phone approves it and it registers',async t=>{
  const {relay,code,bootstrapFile}=await fixture(t)
  if(process.platform!=='win32')assert.equal((await stat(bootstrapFile)).mode&0o777,0o600)
  const admin=phone(relay),stranger=phone(relay)
  assert.deepEqual((await admin.call('GET','/v1/admin/status')).body,{admin:false,claimable:true})
  assert.equal((await stranger.call('POST','/v1/admin/claim',{code:'wrong-code-guess'})).body.code,'INVALID_CODE')
  assert.equal((await admin.call('POST','/v1/admin/claim',{code:await code()})).status,200)
  await assert.rejects(stat(bootstrapFile),{code:'ENOENT'},'the one-time code is removed once claimed')
  assert.equal((await stranger.call('GET','/v1/admin/devices')).body.code,'ADMIN_REQUIRED')

  const desk=computer(relay,'Office PC')
  assert.equal((await desk.register()).code,4401,'an unapproved computer is refused with APPROVAL_REQUIRED')
  const listed=(await admin.call('GET','/v1/admin/devices')).body
  assert.deepEqual(listed.pending.map(item=>[item.computerId,item.name]),[[desk.computerId,'Office PC']])
  assert.equal((await admin.call('POST','/v1/admin/approve',{computerId:desk.computerId})).status,200)
  const approved=await desk.register()
  t.after(()=>approved.ws.terminate())
  assert.equal(approved.reply.type,'registered')
  assert.deepEqual((await admin.call('GET','/v1/admin/devices')).body.approved.map(item=>item.computerId),[desk.computerId])

  // Removing an approved computer disconnects it and refuses it again.
  const closed=once(approved.ws,'close')
  assert.equal((await admin.call('POST','/v1/admin/revoke',{computerId:desk.computerId})).status,200)
  assert.equal((await closed)[0],4401)
  assert.equal((await desk.register()).code,4401)
})

test('admin requests must be fresh, signed by the key they name and used once',async t=>{
  const {relay,code}=await fixture(t)
  const admin=phone(relay)
  await admin.call('POST','/v1/admin/claim',{code:await code()})
  const first=await admin.call('GET','/v1/admin/devices')
  assert.equal(first.status,200)
  assert.equal((await admin.call('GET','/v1/admin/devices',null,{reuse:first.signature,time:first.time})).body.code,'REPLAYED','the same signed request is accepted once')
  assert.equal((await admin.call('GET','/v1/admin/devices',null,{time:Date.now()-10*60000})).status,401,'an old request is refused')
  const other=phone(relay)
  const signed=await admin.call('GET','/v1/admin/status')
  assert.equal((await other.call('GET','/v1/admin/status',null,{reuse:signed.signature,time:signed.time})).status,401,'another key cannot reuse a signature')
  assert.equal((await phone(relay).call('POST','/v1/admin/claim',{code:await code().catch(()=>'gone')})).body.code,'ADMIN_EXISTS')
})

test('a denied computer is not listed again, and approvals survive a restart',async t=>{
  const {relay,approvals,code,file}=await fixture(t)
  const admin=phone(relay)
  await admin.call('POST','/v1/admin/claim',{code:await code()})
  const desk=computer(relay,'Unknown')
  await desk.register()
  await admin.call('POST','/v1/admin/deny',{computerId:desk.computerId})
  await desk.register()
  assert.deepEqual((await admin.call('GET','/v1/admin/devices')).body.pending,[])
  const mine=computer(relay,'Mine')
  await mine.register()
  await admin.call('POST','/v1/admin/approve',{computerId:mine.computerId})
  await approvals.flush()
  const reopened=await createApprovals({file})
  assert.equal(reopened.isApproved(mine.computerId),true)
  assert.equal(reopened.isAdmin(admin.key),true)
})
