import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {randomBytes} from 'node:crypto'
import {WebSocket,WebSocketServer} from 'ws'
import {createRelay} from '../server.mjs'
async function peer(t){
 const relay=await createRelay({secret:randomBytes(32).toString('base64url'),origin:'wss://fixture.example'})
 const ws=new WebSocket(relay.url.replace('http:','ws:')+'/v1/computer');ws.on('error',()=>{})
 t.after(async()=>{ws.terminate();await relay.close()});await once(ws,'message');return ws
}
test('fragmented text still reaches the registration boundary and closes cleanly',{timeout:5000},async t=>{
 const ws=await peer(t),closed=once(ws,'close')
 ws.send('{"type":',{fin:false});ws.send('"register"}')
 assert.equal((await closed)[0],4403)
})
test('Relay retains its one MiB message limit',{timeout:5000},async t=>{
 const ws=await peer(t),closed=once(ws,'close');ws.send(Buffer.alloc(1048577));assert.equal((await closed)[0],1009)
})
test('ws stops excessive tiny fragments below the payload byte limit',{timeout:5000},async t=>{
 const ws=await peer(t),closed=once(ws,'close')
 // Bounded local regression: 16,385 bytes, not an OOM or production probe.
 for(let i=0;i<16385;i++)ws.send(Buffer.from([0]),{fin:false})
 assert.equal((await closed)[0],1008)
})
test('unsafe typed-array close reasons are refused; Uint8Array bytes remain exact',{timeout:5000},async t=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0,skipUTF8Validation:true})
 await once(server,'listening');const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}`,{skipUTF8Validation:true})
 t.after(async()=>{ws.terminate();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r))})
 server.on('connection',client=>{
  assert.throws(()=>client.close(1000,new Float32Array(20)),TypeError)
  client.close(1000,new Uint8Array(80))
 })
 const [code,reason]=await once(ws,'close');assert.equal(code,1000);assert.deepEqual(reason,Buffer.alloc(80))
})
