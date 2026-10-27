import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMobileServer} from '../src/server.js'
test('relay endpoint reuses direct pairing token and owner Agent grant',async t=>{
 const home=await mkdtemp(join(tmpdir(),'bot-relay-endpoint-'));let device
 const adapter={capabilities:()=>({}),state:async(_signal,grant)=>({agentAccess:grant().agents}),dispose:async()=>{}}
 const server=await createMobileServer({home,config:{devAllowInsecure:true},adapter});t.after(async()=>{await server.close();await rm(home,{recursive:true,force:true})})
 const pair=await server.operator('pairing.create');const post=async(path,body)=>{const r=await fetch(server.url+'/mobile/v1/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return r.json()}
 const claim=await post('pairings',{code:pair.code,deviceName:'Fixture phone'});await server.operator('pairing.approve',{requestId:claim.requestId});device=await post('pairings/complete',{claimToken:claim.claimToken})
 assert.equal(typeof server.relayEndpoint,'function');const endpoint=server.relayEndpoint('stream-fixture')
 const request=()=>endpoint.request({method:'GET',path:'/mobile/v1/state',headers:{authorization:'Bearer '+device.accessToken},body:new Uint8Array()})
 assert.equal(JSON.parse(new TextDecoder().decode((await request()).body)).agentAccess,false)
 await server.operator('device.agents',{id:device.deviceId,enabled:true});assert.equal(JSON.parse(new TextDecoder().decode((await request()).body)).agentAccess,true)
 await server.operator('device.revoke',{id:device.deviceId});assert.equal((await request()).status,401)
})
