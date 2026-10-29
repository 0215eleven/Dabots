import test from 'node:test';
import assert from 'node:assert/strict';
import {createDsCore} from '../src/ds/core.ts';
import {guardManagement} from '../src/ds/management.ts';
import {mutationProblem} from '../src/ds/screen-binding.ts';
import {dsId} from '../src/ds/identity.ts';
for(const stage of ['after-ack','during-readback','lost-reply']) for(const operation of ['createBot','duplicateBot']) test(`${operation}: ${stage} retains outcome and review across fresh owner client`, async()=>{
 let active=true,reads=0,writes=0;const ack={id:'created'};const owner=JSON.stringify(['A',stage,operation,'pair-slot']);
 function fixture(fresh=false){const client={action:async()=>{writes++;if(!fresh&&stage!=='during-readback')active=false;if(!fresh&&stage==='lost-reply')throw Error('reply lost');return ack;}} as any;
 const snapshot={serverId:'A',client,source:'live' as const,team:{bots:[{id:'b',name:'Bot'},{id:'created',name:'Created'}],rooms:[],models:[],mobileCapabilities:{actions:['create-bot','duplicate-bot']}},conversations:[]};
 return createDsCore({client,serverId:'A',getSnapshot:()=>snapshot,isCurrent:()=>active,isOnline:()=>true,outbox:null,refresh:async()=>{reads++;if(!fresh)active=false;return snapshot;}});}
 const raw=fixture(),first=guardManagement(raw,owner),invoke=(c:any)=>operation==='createBot'?c.createBot({name:'new'}):c.duplicateBot(dsId('A','bot','b'));
 await assert.rejects(invoke(first.core),(error:any)=>{assert.equal(error.code,stage==='lost-reply'?'MUTATION_UNCONFIRMED':'READBACK_FAILED');assert.equal(error.mutation,stage==='lost-reply'?'unknown':'acknowledged');assert.deepEqual(error.acknowledgement,stage==='lost-reply'?undefined:ack);assert.equal(mutationProblem(error).retry,false);return true;});
 assert.equal(reads,stage==='during-readback'?1:0);assert.equal(writes,1);assert.equal(first.issues().length,1);assert.throws(()=>first.core.read(),{code:'STALE_HOST'});raw.dispose();
 active=true;const fresh=fixture(true),returned=guardManagement(fresh,owner);assert.equal(returned.issues().length,1);const newPair=guardManagement(fresh,owner+'-new-pair');assert.equal(newPair.issues().length,0);await assert.rejects(invoke(returned.core));assert.equal(writes,1);await fresh.refresh();await assert.rejects(invoke(returned.core));assert.equal(writes,1);const reviewed=await returned.review();returned.acknowledge(reviewed);await invoke(returned.core);assert.equal(writes,2);fresh.dispose();
});
