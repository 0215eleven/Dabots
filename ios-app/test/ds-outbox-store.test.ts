import test from 'node:test';
import assert from 'node:assert/strict';
import {createDurableOutboxStore} from '../src/outbox/store.ts';
import {readCache,writeCache} from '../src/storage/cache.web.ts';
import type {OutboxItem} from '../src/outbox/outbox.ts';
const item: OutboxItem={requestId:'durable',conversationId:'actual-chat',text:'keep draft',attachments:[],createdAt:1,state:'queued',attempts:0};
function fixture() {
  const memory=new Map<string,string>();let readFails=false,writeFails=false;
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(key:string){if(readFails)throw new Error('read blocked');return memory.get(key)??null;},setItem(key:string,value:string){if(writeFails)throw new Error('write blocked');memory.set(key,value);}}});
  const store=createDurableOutboxStore('host',{read:readCache,write:writeCache});
  return {store,memory,failRead:()=>{readFails=true;},failWrite:()=>{writeFails=true;},restore:()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete (globalThis as any).localStorage;}};
}
test('verified outbox storage keeps existing host scope and outbox key',async()=>{
  const f=fixture();try{await f.store.save([item]);assert.deepEqual(await f.store.load(),[item]);assert.deepEqual([...f.memory.keys()],['ds-bot:cache:["host","outbox"]']);}finally{f.restore();}
});
test('a swallowed real web cache write failure is exposed before durable enqueue can succeed',async()=>{
  const f=fixture();try{f.failWrite();await assert.rejects(f.store.save([item]),/could not be saved/);}finally{f.restore();}
});
test('a real web cache read failure is distinct from an empty durable queue',async()=>{
  const f=fixture();try{f.failRead();await assert.rejects(f.store.load(),/read blocked/);}finally{f.restore();}
});
