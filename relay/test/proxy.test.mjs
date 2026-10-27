import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {once} from 'node:events'
import WebSocket from 'ws'
import {createRelay} from '../server.mjs'
const options={secret:randomBytes(32).toString('base64url'),origin:'wss://fixture.example'}
async function upgrade(relay,headers){const ws=new WebSocket(relay.url.replace('http:','ws:')+'/v1/phone?computer=missing',{headers});ws.on('error',()=>{});const [,r]=await once(ws,'unexpected-response');r.resume();ws.terminate();return r.statusCode}
async function ipv6Fixture(t,listen=()=>createRelay({...options,host:'::1',trustedProxyIp:'0:0:0:0:0:0:0:1'})){
 try{return await listen()}catch(error){
  if(error.code!=='EAFNOSUPPORT')throw error
  t.skip('IPv6 address family unsupported (EAFNOSUPPORT)');return null
 }
}
test('trusted proxy rejects malformed, empty and duplicate client addresses',async t=>{
 const r=await createRelay({...options,trustedProxyIp:'127.0.0.1'});t.after(()=>r.close())
 for(const h of ['bad','', '192.0.2.1, 192.0.2.2','192.0.2.1:80','fe80::1%eth0',['192.0.2.1','192.0.2.2']])assert.equal(await upgrade(r,{'X-Real-IP':h}),400,JSON.stringify(h))
})
test('only the configured peer may split client limits; explicit setting overrides legacy loopback trust',async t=>{
 for(const proxy of ['127.0.0.1','192.0.2.9']){const r=await createRelay({...options,trustedProxyIp:proxy,trustProxy:true});t.after(()=>r.close());let limited=0
 for(let i=0;i<61;i++)if(await upgrade(r,{'X-Real-IP':`198.51.100.${i}`})===429)limited++
 assert.equal(limited,proxy==='127.0.0.1'?0:1)
 }
})
test('equivalent IPv4-mapped and IPv6 spellings share one rate bucket',async t=>{
 for(const addresses of [['192.0.2.1','::ffff:192.0.2.1','::ffff:c000:201'],['2001:db8::1','2001:0db8:0:0:0:0:0:1']]){
 const r=await createRelay({...options,trustedProxyIp:'::ffff:7f00:1'});t.after(()=>r.close());for(let i=0;i<60;i++)assert.equal(await upgrade(r,{'X-Real-IP':addresses[i%addresses.length]}),409);assert.equal(await upgrade(r,{'X-Real-IP':addresses[0]}),429)
 assert.equal(await upgrade(r,{'X-Real-IP':'203.0.113.25'}),409)
 }
})
test('proxy configuration accepts one IP only and validates before listening',async()=>{
 for(const v of ['',null,[],['127.0.0.1'],'localhost','127.0.0.0/8','127.0.0.1,192.0.2.1','fe80::1%1']){let r;try{await assert.rejects(async()=>{r=await createRelay({...options,trustedProxyIp:v})})}finally{await r?.close()}}
})
test('IPv6 proxy peers accept equivalent configured literals',async t=>{
 const r=await ipv6Fixture(t);if(!r)return;t.after(()=>r.close())
 assert.equal(await upgrade(r,{'X-Real-IP':'2001:db8::2'}),409)
 assert.equal(await upgrade(r,{'X-Real-IP':'invalid'}),400)
})
test('default policy ignores forged and malformed forwarding headers',async t=>{
 const r=await createRelay(options);t.after(()=>r.close())
 for(let i=0;i<60;i++)assert.equal(await upgrade(r,{'X-Real-IP':i%2?'invalid':`192.0.2.${i}`}),409)
 assert.equal(await upgrade(r,{'X-Real-IP':'203.0.113.1'}),429)
})
test('IPv6 addresses outside the exact mapped prefix never collapse to IPv4',async t=>{
 const r=await createRelay({...options,trustedProxyIp:'127.0.0.1'});t.after(()=>r.close())
 for(let i=0;i<60;i++)assert.equal(await upgrade(r,{'X-Real-IP':'::ffff:0:c000:201'}),409)
 assert.equal(await upgrade(r,{'X-Real-IP':'0.0.192.0'}),409)
})
test('IPv6 fixture skips only address-family unsupported and propagates all other errors',async()=>{
 assert.equal(typeof ipv6Fixture,'function')
 let skips=0
 assert.equal(await ipv6Fixture({skip:()=>{skips++}},async()=>{throw Object.assign(Error('IPv6 unavailable'),{code:'EAFNOSUPPORT'})}),null)
 assert.equal(skips,1)
 for(const code of ['EACCES','EADDRINUSE','EADDRNOTAVAIL',undefined]){
  const error=Object.assign(Error('must fail'),{code})
  await assert.rejects(ipv6Fixture({skip:()=>{throw Error('unexpected skip')}},async()=>{throw error}),e=>e===error)
 }
 const value={fixture:true};assert.equal(await ipv6Fixture({skip:()=>{throw Error('unexpected skip')}},async()=>value),value)
})

