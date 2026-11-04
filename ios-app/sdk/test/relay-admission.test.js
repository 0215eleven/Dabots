import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayTransport} from '../relay-transport.js';
const relay='wss://fixture.example',computerId='A'.repeat(22),computerKey='A'.repeat(43),serverId='fixture-server';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,options={}){
 let socket;const sent=[];
 class Socket{readyState=1;bufferedAmount=0;constructor(){socket=this;}send(value){sent.push(value);}close(){this.readyState=3;}receive(value){this.onmessage({data:JSON.stringify(value)});}}
 const transport=createRelayTransport({relay,computerId,computerKey,serverId,randomBytes:n=>new Uint8Array(n).fill(7),WebSocket:Socket,...options});
 const result=transport.fetch(transport.baseUrl+'/mobile/v1/info').catch(error=>error);
 t.after(async()=>{transport.dispose();await result;});
 return {socket,sent,result};
}
test('an official transport refuses legacy connected control before revealing encrypted pairing data',async t=>{
 const f=fixture(t,{requireAccess:true,authenticate:async()=>{throw Error('Must not sign');}});
 f.socket.receive({type:'connected',streamId:'A'.repeat(22)});
 assert.equal((await f.result).code,'RELAY_ACCESS_REQUIRED');assert.equal(f.sent.length,0);
});
test('a relay challenge is bound to the exact target before the phone signer runs',async t=>{
 let called=0;const f=fixture(t,{requireAccess:true,authenticate:async()=>{called++;return {};}});
 f.socket.receive({type:'phone-challenge',access:1,nonce:'B'.repeat(42)+'A',computerId,computerKey,serverId:'foreign-server'});
 assert.equal((await f.result).code,'RELAY_PROTOCOL_ERROR');assert.equal(called,0);assert.equal(f.sent.length,0);
});
test('a valid relay challenge sends only the scoped phone proof before any encrypted offer',async t=>{
 let challenge;const f=fixture(t,{requireAccess:true,authenticate:async value=>{challenge=value;return {key:'A'.repeat(43),signature:'A'.repeat(86),secretKey:'must-never-leave'};}});
 f.socket.receive({type:'phone-challenge',access:1,nonce:'A'.repeat(43),computerId,computerKey,serverId});await tick();
 assert.deepEqual(challenge,{relay,nonce:'A'.repeat(43),computerId,computerKey,serverId});
 assert.equal(f.sent.length,1);assert.deepEqual(JSON.parse(f.sent[0]),{type:'authenticate',key:'A'.repeat(43),signature:'A'.repeat(86)});
});
