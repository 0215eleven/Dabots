import test from 'node:test';import assert from 'node:assert/strict';
import {createPreviewBudget} from '../src/ds/preview-budget.ts';
const limits={resident:3,files:5,bytes:5*1048576,perFile:1048576,waiters:8,timeout:1000};
test('excess previews wait FIFO without owning bytes and continue automatically when a slot is released',async()=>{
 const pool=createPreviewBudget(limits),held=await Promise.all([pool.acquire(),pool.acquire(),pool.acquire()]),order:number[]=[];
 const pending=[0,1,2].map(n=>pool.acquire().then(lease=>{order.push(n);return lease}));assert.equal(pool.used,3);assert.equal(pool.waiting,3);assert.equal(pool.reservedBytes,3*1048576);
 held[1].release();const first=await pending[0];assert.deepEqual(order,[0]);first.release();const second=await pending[1];second.release();const third=await pending[2];third.release();held.forEach(l=>l.release());assert.equal(pool.used,0);assert.equal(pool.waiting,0);
});
test('two bounded refresh reserves can replace full resident pictures without blocking behind new images',async()=>{
 const pool=createPreviewBudget(limits),held=await Promise.all([pool.acquire(),pool.acquire(),pool.acquire()]),controller=new AbortController(),waiting=pool.acquire({signal:controller.signal});
 const one=await pool.acquire({replace:held[0]}),two=await pool.acquire({replace:held[1]});assert.equal(pool.used,5);assert.equal(pool.reservedBytes,limits.bytes);
 const cancelled=assert.rejects(waiting,{name:'AbortError'});controller.abort();await cancelled;held[0].release();held[1].release();one.release();two.release();held[2].release();assert.equal(pool.used,0);
});
test('cancel, timeout and excessive waiting are bounded and leak no reservations',async()=>{
 const pool=createPreviewBudget({...limits,resident:1,files:1,bytes:1048576,waiters:1,timeout:20}),held=await pool.acquire(),pending=pool.acquire();
 await assert.rejects(pool.acquire(),{code:'PREVIEW_CAPACITY'});await assert.rejects(pending,{code:'PREVIEW_CAPACITY'});assert.equal(pool.waiting,0);assert.equal(pool.used,1);
 const controller=new AbortController(),cancelled=pool.acquire({signal:controller.signal}),denied=assert.rejects(cancelled,{name:'AbortError'});controller.abort();await denied;held.release();assert.equal(pool.used,0);assert.equal(pool.waiting,0);
});

test('the production budget holds fourteen residents plus two refreshes, never more than sixteen MiB',async()=>{
 const pool=createPreviewBudget(),held=await Promise.all(Array.from({length:14},()=>pool.acquire())),controller=new AbortController(),blocked=pool.acquire({signal:controller.signal}),cancelled=assert.rejects(blocked,{name:'AbortError'});
 const refresh=await Promise.all([pool.acquire({replace:held[0]}),pool.acquire({replace:held[1]})]);assert.equal(pool.used,16);assert.equal(pool.reservedBytes,16777216);assert.equal(pool.waiting,1);controller.abort();await cancelled;[...held,...refresh].forEach(lease=>lease.release());assert.equal(pool.used,0);
});
