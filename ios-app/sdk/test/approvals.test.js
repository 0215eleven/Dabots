import test from 'node:test';import assert from 'node:assert/strict';
import {MobileClient,MemoryTokenStore} from '../index.js';
const token=()=>new MemoryTokenStore({accessToken:'synthetic',refreshToken:'synthetic-refresh',serverId:'fixture',deviceId:'synthetic-device',expiresAt:Date.now()+3600000});
test('tool approvals are listed per conversation and answered with allow or reject only',async t=>{
 const requests=[];const client=new MobileClient({baseUrl:'https://fixture.example',tokenStore:token(),fetch:async(url,init)=>{const path=new URL(url).pathname;if(path.endsWith('/info'))return Response.json({protocolVersion:1,serverId:'fixture'});requests.push([init.method??'GET',path,init.body?JSON.parse(init.body):null]);return Response.json(path.endsWith('/approvals')?{approvals:[{id:'ap-1',conversationId:'agent:a:s',tool:'bash',reason:'ls'}]}:{answered:true});}});t.after(()=>client.dispose());
 assert.equal((await client.approvals('agent:a:s')).approvals[0].id,'ap-1');
 assert.deepEqual(await client.answerApproval('ap-1','allow'),{answered:true});
 assert.throws(()=>client.answerApproval('ap-1','always'),{code:'invalid_choice'});
 assert.deepEqual(requests,[['GET','/mobile/v1/conversations/agent%3Aa%3As/approvals',null],['POST','/mobile/v1/approvals/ap-1',{choice:'allow'}]]);
});
