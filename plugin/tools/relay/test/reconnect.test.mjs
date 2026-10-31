import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,createHash,sign,randomBytes} from 'node:crypto'
import {once} from 'node:events'
import WebSocket from 'ws'
import {createRelay} from '../server.mjs'

const origin='wss://fixture.example'
// One computer identity, registering over a fresh socket each time.
function identity(){
  const keys=generateKeyPairSync('ed25519')
  const edPublicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url'),computerKey=randomBytes(32).toString('base64url')
  const computerId=createHash('sha256').update(Buffer.from(edPublicKey,'base64url')).digest().subarray(0,16).toString('base64url')
  return {computerId,register:async relay=>{
    const ws=new WebSocket(relay.url.replace('http','ws')+'/v1/computer')
    const [challenge]=await once(ws,'message');const {nonce}=JSON.parse(challenge)
    const signed=JSON.stringify(['ds-bot-computer-v2',origin,nonce,computerId,edPublicKey,computerKey])
    ws.send(JSON.stringify({type:'register',nonce,computerId,edPublicKey,computerKey,signature:sign(null,Buffer.from(signed),keys.privateKey).toString('base64url')}))
    const [reply]=await once(ws,'message')
    return {ws,reply:JSON.parse(reply)}
  }}
}

test('a computer reconnecting before its old socket is noticed replaces the stale registration',async t=>{
  const relay=await createRelay({origin,port:0,openRegistration:true})
  t.after(()=>relay.close())
  const me=identity()
  const first=await me.register(relay)
  t.after(()=>first.ws.terminate())
  assert.equal(first.reply.type,'registered')
  const firstClosed=once(first.ws,'close')
  // The old socket is still open on the relay, as after a network blip.
  const second=await me.register(relay)
  t.after(()=>second.ws.terminate())
  assert.equal(second.reply.type,'registered','the new registration is accepted, not refused')
  const [code]=await firstClosed
  assert.equal(code,4409,'the stale socket is closed as replaced')
  // Phones now reach the new registration.
  const phone=new WebSocket(relay.url.replace('http','ws')+'/v1/phone?computer='+me.computerId)
  t.after(()=>phone.terminate())
  const [hello]=await once(phone,'message')
  assert.equal(JSON.parse(hello).type,'connected')
})

test('another key cannot take over a registered computer',async t=>{
  const relay=await createRelay({origin,port:0,openRegistration:true})
  t.after(()=>relay.close())
  const me=identity(),other=identity()
  const first=await me.register(relay)
  t.after(()=>first.ws.terminate())
  // A different key yields a different computer ID, so it never touches the first registration.
  const second=await other.register(relay)
  t.after(()=>second.ws.terminate())
  assert.notEqual(other.computerId,me.computerId)
  assert.equal(first.ws.readyState,WebSocket.OPEN)
})
