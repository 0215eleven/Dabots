import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,createHash,sign,randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import WebSocket from 'ws'
import {createRelay} from '../server.mjs'
import {createAccounts} from '../accounts.mjs'

const origin='wss://fixture.example'
async function fixture(t,options={}){
  const dir=await mkdtemp(join(tmpdir(),'relay-accounts-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const file=join(dir,'accounts.json'),bootstrapFile=join(dir,'bootstrap-code')
  const accounts=await createAccounts({file,bootstrapFile,...options})
  const relay=await createRelay({origin,port:0,accounts,...(options.secret?{secret:options.secret}:{})})
  t.after(()=>relay.close())
  const call=async(method,path,body,token,headers={})=>{
    const response=await fetch(relay.url+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{}),...headers},body:body?JSON.stringify(body):undefined})
    return {status:response.status,body:await response.json()}
  }
  const bootstrap=async()=>(await readFile(bootstrapFile,'utf8')).trim()
  return {relay,accounts,file,bootstrapFile,bootstrap,call}
}
function computer(relay,register){
  const ws=new WebSocket(relay.url.replace('http','ws')+'/v1/computer')
  const keys=generateKeyPairSync('ed25519')
  const edPublicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url'),computerKey=randomBytes(32).toString('base64url')
  const computerId=createHash('sha256').update(Buffer.from(edPublicKey,'base64url')).digest().subarray(0,16).toString('base64url')
  const done=once(ws,'message').then(([challenge])=>{
    const {nonce}=JSON.parse(challenge)
    const signed=JSON.stringify(['ds-bot-computer-v2',origin,nonce,computerId,edPublicKey,computerKey])
    ws.send(JSON.stringify({type:'register',nonce,computerId,edPublicKey,computerKey,signature:sign(null,Buffer.from(signed),keys.privateKey).toString('base64url'),...register}))
    return new Promise(resolve=>{ws.once('message',data=>resolve({type:'message',value:JSON.parse(data)}));ws.once('close',code=>resolve({type:'close',code}))})
  })
  return {ws,computerId,computerKey,done}
}

test('the first account needs the server-side bootstrap code and becomes the admin; later accounts need an invite',async t=>{
  const {call,file,bootstrap,bootstrapFile}=await fixture(t)
  assert.deepEqual((await call('GET','/v1/account/info')).body,{registration:'invite',relay:origin})
  assert.equal((await call('POST','/v1/account/register',{username:'squatter',password:'squatter password'})).body.code,'BOOTSTRAP_REQUIRED','nobody claims the relay without the server-side code')
  const code=await bootstrap()
  if(process.platform!=='win32')assert.equal((await stat(bootstrapFile)).mode&0o777,0o600)
  const admin=await call('POST','/v1/account/register',{username:'Eleven',email:'Owner@Example.com',password:'correct horse',invite:code})
  assert.equal(admin.status,200)
  assert.deepEqual(admin.body.account,{id:admin.body.account.id,username:'eleven',email:'owner@example.com',admin:true})
  await assert.rejects(stat(bootstrapFile),{code:'ENOENT'},'the bootstrap code is removed once used')
  assert.equal((await call('POST','/v1/account/register',{username:'guest',password:'guest password',invite:code})).body.code,'INVITE_REQUIRED')
  const invite=await call('POST','/v1/account/invites',{},admin.body.token)
  const guest=await call('POST','/v1/account/register',{username:'guest',password:'guest password',invite:invite.body.code})
  assert.equal(guest.status,200);assert.equal(guest.body.account.admin,false)
  assert.equal((await call('POST','/v1/account/register',{username:'other',password:'other password',invite:invite.body.code})).body.code,'INVITE_REQUIRED','an invite works once')
  assert.equal((await call('POST','/v1/account/invites',{},guest.body.token)).body.code,'ADMIN_REQUIRED')
  assert.equal((await call('POST','/v1/account/register',{username:'guest',password:'x'.repeat(8),invite:'nope'})).status,403)
  const saved=await readFile(file,'utf8')
  for(const secret of ['correct horse','guest password',admin.body.token,invite.body.code,code])assert.equal(saved.includes(secret),false,'passwords, tokens and invites are stored only as hashes')
  if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600)
})

test('login by username or email, logout and password change end sessions',async t=>{
  const {call,bootstrap}=await fixture(t,{registration:'open'})
  await call('POST','/v1/account/register',{username:'eleven',email:'owner@example.com',password:'correct horse',invite:await bootstrap()})
  assert.equal((await call('POST','/v1/account/login',{login:'nobody',password:'correct horse'})).body.code,'INVALID_LOGIN')
  assert.equal((await call('POST','/v1/account/login',{login:'eleven',password:'wrong password'})).body.code,'INVALID_LOGIN')
  const byEmail=await call('POST','/v1/account/login',{login:'OWNER@example.com',password:'correct horse'})
  assert.equal(byEmail.status,200)
  assert.equal((await call('GET','/v1/account/me',null,byEmail.body.token)).body.account.username,'eleven')
  await call('POST','/v1/account/logout',null,byEmail.body.token)
  assert.equal((await call('GET','/v1/account/me',null,byEmail.body.token)).status,401)
  const a=await call('POST','/v1/account/login',{login:'eleven',password:'correct horse'})
  const changed=await call('POST','/v1/account/password',{password:'correct horse',next:'battery staple'},a.body.token)
  assert.equal(changed.status,200)
  assert.equal((await call('GET','/v1/account/me',null,a.body.token)).status,401,'the old session ends')
  assert.equal((await call('GET','/v1/account/me',null,changed.body.token)).status,200)
  assert.equal((await call('POST','/v1/account/login',{login:'eleven',password:'battery staple'})).status,200)
})

test('repeated wrong passwords are limited and browsers are refused',async t=>{
  const {call,bootstrap}=await fixture(t)
  await call('POST','/v1/account/register',{username:'eleven',password:'correct horse',invite:await bootstrap()})
  for(let i=0;i<10;i++)assert.equal((await call('POST','/v1/account/login',{login:'eleven',password:'wrong password'})).status,401)
  assert.equal((await call('POST','/v1/account/login',{login:'eleven',password:'correct horse'})).body.code,'RATE_LIMITED')
  assert.equal((await call('GET','/v1/account/info',null,null,{origin:'https://evil.example'})).body.code,'ORIGIN_DENIED')
})

test('a computer registers with its owner session and is listed only for that owner',async t=>{
  const {relay,call,accounts,bootstrap}=await fixture(t,{registration:'open'})
  const owner=await call('POST','/v1/account/register',{username:'eleven',password:'correct horse',invite:await bootstrap()})
  const other=await call('POST','/v1/account/register',{username:'other',password:'other password'})
  const desk=computer(relay,{accountToken:owner.body.token,name:'Office',serverId:'srv-office'})
  t.after(()=>desk.ws.terminate())
  const registered=await desk.done
  assert.deepEqual(registered.value,{type:'registered',computerId:desk.computerId,account:'eleven'})
  const listed=(await call('GET','/v1/account/computers',null,owner.body.token)).body.computers
  assert.equal(listed.length,1)
  assert.deepEqual({...listed[0],lastSeenAt:0},{computerId:desk.computerId,computerKey:desk.computerKey,serverId:'srv-office',name:'Office',relay:origin,online:true,lastSeenAt:0})
  assert.deepEqual((await call('GET','/v1/account/computers',null,other.body.token)).body.computers,[])
  // The same computer key cannot be claimed by another account.
  desk.ws.terminate();await once(desk.ws,'close')
  await accounts.bindComputer(accounts.authenticate(owner.body.token).account,{id:desk.computerId,computerKey:desk.computerKey})
  await assert.rejects(accounts.bindComputer(accounts.authenticate(other.body.token).account,{id:desk.computerId,computerKey:desk.computerKey}),{code:'COMPUTER_OWNED'})
  await new Promise(r=>setTimeout(r,50))
  assert.equal((await call('GET','/v1/account/computers',null,owner.body.token)).body.computers[0].online,false)
  assert.equal((await call('DELETE',`/v1/account/computers/${desk.computerId}`,null,owner.body.token)).status,200)
  assert.deepEqual((await call('GET','/v1/account/computers',null,owner.body.token)).body.computers,[])
})

test('without a valid session or secret a computer is refused; the shared secret still works',async t=>{
  const secret=randomBytes(32).toString('base64url')
  const {relay}=await fixture(t,{secret})
  const stranger=computer(relay,{accountToken:'not-a-session-token-at-all'})
  assert.deepEqual(await stranger.done,{type:'close',code:4403})
  const legacy=computer(relay,{secret})
  t.after(()=>legacy.ws.terminate())
  assert.equal((await legacy.done).value.type,'registered')
})

test('accounts survive a restart and a relay without accounts keeps requiring its secret',async t=>{
  const {call,file,accounts,bootstrap}=await fixture(t)
  const {body}=await call('POST','/v1/account/register',{username:'eleven',password:'correct horse',invite:await bootstrap()})
  await accounts.flush()
  const reopened=await createAccounts({file})
  assert.equal(reopened.authenticate(body.token)?.account.username,'eleven')
  await assert.rejects(createRelay({origin,port:0}),/secret/)
})
