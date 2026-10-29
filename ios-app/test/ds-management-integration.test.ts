import test from 'node:test';
import assert from 'node:assert/strict';
import type {MobileClient} from '@ds-bot/mobile-sdk';
import {createDsCore,DS_ACTIONS} from '../src/ds/core.ts';
import {guardManagement} from '../src/ds/management.ts';
import {dsId} from '../src/ds/identity.ts';
import type {TeamState} from '../src/types.ts';
function fixture(){let calls=0,reads=0;const client={action:async()=>{calls++;throw Error('lost reply')},cancel:async()=>{calls++;throw Error('lost reply')}} as unknown as MobileClient;
 const team:TeamState={bots:[{id:'b',name:'Bot'}],rooms:[{id:'g',name:'Group',members:['b']}],models:[],mobileCapabilities:{actions:[...DS_ACTIONS],cancel:true}};
 const snapshot={client,serverId:'h',source:'live' as const,team,conversations:[{id:'b',kind:'bot',name:'Bot',sessionId:'s'}]};
 const core=createDsCore({client,serverId:'h',getSnapshot:()=>snapshot,refresh:async()=>{reads++;return snapshot},isCurrent:()=>true,isOnline:()=>true,outbox:null});
 return {client,core,count:()=>calls,reads:()=>reads,bot:dsId('h','bot','b'),group:dsId('h','group','g'),chat:dsId('h','conversation','b')};}
test('actual core management uncertainty survives control remount and requires explicit canonical review',async()=>{
 const f=fixture();const first=guardManagement(f.core,f.client);
 await assert.rejects(first.core.duplicateBot(f.bot),{code:'MUTATION_UNCONFIRMED'});
 const remount=guardManagement(f.core,f.client);
 await assert.rejects(remount.core.duplicateBot(f.bot),{code:'MUTATION_UNCONFIRMED'});assert.equal(f.count(),1);
 await f.core.refresh();await assert.rejects(remount.core.duplicateBot(f.bot));assert.equal(f.count(),1,'poll/read alone cannot imply user review');
 const reviewed=await remount.review();assert.equal(f.reads(),2);remount.acknowledge(reviewed);
 await assert.rejects(remount.core.duplicateBot(f.bot));assert.equal(f.count(),2,'new intent only after fresh canonical read and explicit acknowledgement');f.core.dispose();
});
test('delete/group/flags/Stop controls all retain operation uncertainty across owners remount',async()=>{
 const operations=['deleteBot','deleteGroup','setFlags','cancel','stopGroupMember'] as const;
 for(const name of operations){const f=fixture();const invoke=(guard:ReturnType<typeof guardManagement>)=>name==='deleteBot'?guard.core.deleteBot(f.bot):name==='deleteGroup'?guard.core.deleteGroup(f.group):name==='setFlags'?guard.core.setFlags(f.chat,{hidden:true}):name==='cancel'?guard.core.cancel(f.chat):guard.core.stopGroupMember(f.group,f.bot);
 await assert.rejects(invoke(guardManagement(f.core,f.client)),{code:'MUTATION_UNCONFIRMED'});await assert.rejects(invoke(guardManagement(f.core,f.client)),{code:'MUTATION_UNCONFIRMED'});assert.equal(f.count(),1,name);f.core.dispose();}
});
test('acknowledged readback failure stays distinct and a failed review cannot authorize another write',async()=>{
 let writes=0;const client={action:async()=>{writes++;return{changed:true}}} as unknown as MobileClient;
 const team:TeamState={bots:[],rooms:[],models:[],mobileCapabilities:{actions:['set-prefs']}};
 const snapshot={client,serverId:'h',source:'live' as const,team,conversations:[]};
 const core=createDsCore({client,serverId:'h',getSnapshot:()=>snapshot,refresh:async()=>{throw Error('readback unavailable')},isCurrent:()=>true,isOnline:()=>true,outbox:null});
 const guard=guardManagement(core,client);await assert.rejects(guard.core.setPreferences({motion:'quiet'}),{code:'READBACK_FAILED'});
 assert.equal(guard.issues()[0].acknowledged,true);await assert.rejects(guard.review());await assert.rejects(guardManagement(core,client).core.setPreferences({motion:'quiet'}),{code:'READBACK_FAILED'});assert.equal(writes,1);core.dispose();
});
