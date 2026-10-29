import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, type OutboxItem } from '../src/outbox/outbox.ts';

function fixture(script: { receipt?: (id: string) => any; submit?: (s: any) => any } = {}, saved: OutboxItem[] = []) {
  let clock = 1000, next = 0, saves: OutboxItem[][] = [];
  const timers = new Map<number, { at: number; run: () => void }>();
  const calls: string[] = [];
  const transport = {
    deviceId: async () => 'device-1',
    target: async () => ({ sessionId: 's1' }),
    submission: async (id: string) => { calls.push(`receipt:${id}`); return script.receipt ? script.receipt(id) : Promise.reject({ status: 404 }); },
    submit: async (s: any) => { calls.push(`submit:${s.requestId}`); return script.submit ? script.submit(s) : { requestId: s.requestId, status: 'accepted' }; },
  };
  const outbox = createOutbox({
    store: { load: async () => saved, save: async items => { saves.push(items); } },
    transport: () => transport, now: () => clock, random: () => 1,
    newId: () => `r${++next}`,
    setTimer: ((run: () => void, ms: number) => { const id = ++next + 100; timers.set(id, { at: clock + ms, run }); return id; }) as any,
    clearTimer: ((id: number) => timers.delete(id)) as any,
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { outbox, calls, saves: () => saves, settle, timers,
    advance(ms: number) { clock += ms; for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.run(); } } };
}

test('a message is checked for a receipt, submitted once, and kept as sent until the transcript row arrives', async () => {
  const f = fixture();
  const item = await f.outbox.enqueue({ conversationId: 'chief', text: ' hello ' });
  await f.settle();
  assert.equal(item?.text, 'hello');
  assert.deepEqual(f.calls, ['receipt:r1', 'submit:r1']);
  assert.equal(f.outbox.list()[0].state, 'sent');
  await f.outbox.settle('chief', [{role:'user', requestId: 'other', sessionId: 's1' }]);
  assert.equal(f.outbox.list().length, 1);
  await f.outbox.settle('chief', [{role:'user', requestId: 'r1', sessionId: 's1' }]);
  assert.equal(f.outbox.list().length, 0);
  assert.deepEqual(f.saves().at(-1), []);
});

test('empty messages are ignored', async () => {
  const f = fixture();
  assert.equal(await f.outbox.enqueue({ conversationId: 'chief', text: '   ' }), null);
});

test('a transport failure backs off, a recovered network resumes at once, and the id never changes', async () => {
  let fail = true;
  const f = fixture({ receipt: () => { if (fail) throw new Error('offline'); return Promise.reject({ status: 404 }); } });
  await f.outbox.enqueue({ conversationId: 'chief', text: 'later' });
  await f.settle();
  let item = f.outbox.list()[0];
  assert.equal(item.state, 'queued'); assert.equal(item.attempts, 1); assert.ok(item.retryAt! > 1000);
  fail = false;
  await f.outbox.resume();
  item = f.outbox.list()[0];
  assert.equal(item.state, 'sent'); assert.equal(item.requestId, 'r1');
  assert.equal(f.calls.filter(call => call.startsWith('submit')).length, 1);
});

test('the retry timer fires after the backoff delay', async () => {
  let fail = true;
  const f = fixture({ receipt: () => { if (fail) throw new Error('offline'); return Promise.reject({ status: 404 }); } });
  await f.outbox.enqueue({ conversationId: 'chief', text: 'x' });
  await f.settle();
  fail = false;
  f.advance(15000); await f.settle(); await f.settle();
  assert.equal(f.outbox.list()[0].state, 'sent');
});

test('auto retries are bounded and then require a manual retry; an earlier item blocks later ones', async () => {
  const f = fixture({ receipt: () => { throw new Error('offline'); } });
  await f.outbox.enqueue({ conversationId: 'chief', text: 'one' });
  await f.outbox.enqueue({ conversationId: 'chief', text: 'two' });
  for (let attempt = 0; attempt < 8; attempt++) { await f.outbox.resume(); await f.settle(); }
  const [first, second] = f.outbox.list();
  assert.equal(first.state, 'unconfirmed'); assert.equal(second.state, 'queued');
  assert.equal(f.calls.some(call => call.endsWith(':r2') || call.includes('r2')), false);
});

test('a definite refusal is rejected and never retried automatically', async () => {
  const f = fixture({ submit: () => Promise.reject({ status: 413 }) });
  await f.outbox.enqueue({ conversationId: 'chief', text: 'big' });
  await f.settle();
  assert.equal(f.outbox.list()[0].state, 'rejected');
  await f.outbox.resume();
  assert.equal(f.calls.filter(call => call.startsWith('submit')).length, 1);
  await f.outbox.retry('r1');
  assert.equal(f.outbox.list()[0].state, 'rejected');
  await f.outbox.discard('r1');
  assert.equal(f.outbox.list().length, 0);
});

test('a lost response is reconciled by receipt after a restart without a second submit', async () => {
  const saved: OutboxItem[] = [{ requestId: 'old', conversationId: 'chief', text: 'was in flight', attachments: [], createdAt: 1, state: 'sending', attempts: 0, deviceId: 'device-1', sessionId: 's1' }];
  const f = fixture({ receipt: id => ({ requestId: id, status: 'accepted' }) }, saved);
  await f.outbox.resume();
  assert.deepEqual(f.calls, ['receipt:old']);
  assert.equal(f.outbox.list()[0].state, 'sent');
});

test('a send from a previous pairing is rejected rather than retried', async () => {
  const saved: OutboxItem[] = [{ requestId: 'old', conversationId: 'chief', text: 'x', attachments: [], createdAt: 1, state: 'queued', attempts: 0, deviceId: 'device-0' }];
  const f = fixture({}, saved);
  await f.outbox.resume();
  assert.equal(f.outbox.list()[0].state, 'rejected');
  assert.deepEqual(f.calls, []);
});

test('unknown host status stays unconfirmed for the user to decide', async () => {
  const f = fixture({ receipt: id => ({ requestId: id, status: 'pending' }) });
  await f.outbox.enqueue({ conversationId: 'chief', text: 'x' });
  await f.settle();
  assert.equal(f.outbox.list()[0].state, 'unconfirmed');
  assert.equal(f.calls.filter(call => call.startsWith('submit')).length, 0);
});

test('enqueue persistence failure does not report a durable item or submit it', async () => {
  let submissions=0;
  const queue=createOutbox({store:{load:async()=>[],save:async()=>{throw new Error('disk full');}},newId:()=> 'durable',
    transport:()=>({deviceId:async()=> 'device',target:async()=>({sessionId:'s'}),submission:async()=>{throw {status:404};},submit:async()=>{submissions++;return {requestId:'durable',status:'accepted'};}})});
  try {
    await assert.rejects(queue.enqueue({conversationId:'c',text:'keep this draft'}),{code:'PERSISTENCE_UNCONFIRMED',requestId:'durable'});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(submissions,0);assert.equal(queue.list()[0].state,'unconfirmed');assert.equal(queue.list()[0].persistence,'unconfirmed');
  } finally {queue.dispose();}
});

test('a receipt for a different request, conversation or session cannot accept this send', async () => {
  for (const mismatch of [{requestId:'another'}, {conversationId:'other'}, {sessionId:'other'}]) {
    const f=fixture({receipt:id=>({requestId:id,status:'accepted',...mismatch})});
    await f.outbox.enqueue({conversationId:'chief',text:'hello'});await f.settle();
    assert.equal(f.outbox.list()[0].state,'unconfirmed');assert.equal(f.calls.some(call=>call.startsWith('submit:')),false);f.outbox.dispose();
  }
});

test('a failed durable load cannot overwrite queued sends with a new empty state', async () => {
  let saved=0;
  const queue=createOutbox({store:{load:async()=>{throw new Error('storage locked');},save:async()=>{saved++;}},transport:()=>({deviceId:async()=> 'd',target:async()=>({sessionId:'s'}),submission:async()=>({requestId:'x',status:'accepted'}),submit:async()=>({requestId:'x',status:'accepted'})}),newId:()=> 'x'});
  try {await assert.rejects(queue.enqueue({conversationId:'c',text:'hello'}),/storage locked/);assert.equal(saved,0);}finally{queue.dispose();}
});

test('disposing the previous host outbox stops delivery after a pending device lookup', async () => {
  let resolve!: (id:string)=>void,targets=0;
  const device=new Promise<string>(done=>{resolve=done;});
  const queue=createOutbox({store:{load:async()=>[],save:async()=>{}},newId:()=> 'x',transport:()=>({deviceId:()=>device,target:async()=>{targets++;return {sessionId:'s'};},submission:async()=>({requestId:'x',status:'accepted'}),submit:async()=>({requestId:'x',status:'accepted'})})});
  await queue.enqueue({conversationId:'c',text:'hello'});await new Promise(resolve=>setImmediate(resolve));queue.dispose();resolve('device');await new Promise(resolve=>setImmediate(resolve));assert.equal(targets,0);
});

test('session identity must be persisted before sending to the host', async () => {
  let submissions=0;
  const queue=createOutbox({store:{load:async()=>[],save:async items=>{if(items.some(i=>i.sessionId))throw new Error('session disk failure');}},newId:()=> 'x',setTimer:()=>0,clearTimer:()=>{},
    transport:()=>({deviceId:async()=> 'device',target:async()=>({sessionId:'original-session'}),submission:async()=>{throw {status:404};},submit:async()=>{submissions++;return {requestId:'x',status:'accepted'};}})});
  await queue.enqueue({conversationId:'c',text:'hello'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(submissions,0);assert.notEqual(queue.list()[0].state,'sent');queue.dispose();
});

test('ambiguous enqueue stays visible and non-executable across restart; retries retain its one request ID', async () => {
  let disk: OutboxItem[]=[], broken=true, saves=0, ids=0;
  const submitted:string[]=[];
  const store={load:async()=>structuredClone(disk),save:async(items:OutboxItem[])=>{
    if(!broken || ++saves===1)disk=structuredClone(items);
    if(broken)throw new Error('verification and rollback unavailable');
  }};
  const transport={deviceId:async()=> 'device',target:async()=>({sessionId:'session'}),submission:async()=>{throw {status:404};},submit:async(input:{requestId:string})=>{submitted.push(input.requestId);return {requestId:input.requestId,status:'accepted'};}};
  const queue=createOutbox({store,newId:()=>`stable-${++ids}`,transport:()=>transport});
  await assert.rejects(queue.enqueue({conversationId:'c',text:'send once'}),{code:'PERSISTENCE_UNCONFIRMED',requestId:'stable-1'});
  assert.equal(queue.list()[0].state,'unconfirmed');assert.equal(queue.list()[0].requestId,'stable-1');
  assert.equal(disk[0].state,'unconfirmed');assert.deepEqual(submitted,[]);
  await assert.rejects(queue.enqueue({conversationId:'c',text:'send once'}),{code:'PERSISTENCE_UNCONFIRMED',requestId:'stable-1'});
  assert.equal(ids,1);queue.dispose();broken=false;
  const restored=createOutbox({store,newId:()=>`stable-${++ids}`,transport:()=>transport});
  await restored.resume();assert.equal(restored.list()[0].state,'unconfirmed');assert.deepEqual(submitted,[]);
  await restored.retry('stable-1');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(submitted,['stable-1']);assert.equal(restored.list()[0].state,'sent');restored.dispose();
});

test('verified enqueue rollback can report absence, but failed discard cannot hide an ambiguous item',async()=>{
  let disk:OutboxItem[]=[], first=true, broken=false;
  const store={load:async()=>structuredClone(disk),save:async(items:OutboxItem[])=>{
    if(broken)throw new Error('storage blocked');disk=structuredClone(items);
    if(first){first=false;throw new Error('verification failed');}
  }};
  const queue=createOutbox({store,newId:()=> 'stable',transport:()=>null});
  await assert.rejects(queue.enqueue({conversationId:'c',text:'hello'}),/verification failed/);
  assert.deepEqual(queue.list(),[]);assert.deepEqual(disk,[]);
  broken=true;
  await assert.rejects(queue.enqueue({conversationId:'c',text:'hello'}),{code:'PERSISTENCE_UNCONFIRMED'});
  await assert.rejects(queue.discard('stable'),{code:'PERSISTENCE_UNCONFIRMED',requestId:'stable'});
  assert.equal(queue.list()[0].requestId,'stable');broken=false;await queue.discard('stable');
  assert.deepEqual(queue.list(),[]);assert.deepEqual(disk,[]);queue.dispose();
});

test('uncertain queued promotion never rejects or hides an already verified intent',async()=>{
  for(const wrote of [false,true]) {
    let disk:OutboxItem[]=[],writes=0;const submits:string[]=[];
    const store={load:async()=>structuredClone(disk),save:async(items:OutboxItem[])=>{
      writes++;if(writes!==2||wrote)disk=structuredClone(items);
      if(writes===2)throw new Error('promotion verification failed');
    }};
    const queue=createOutbox({store,newId:()=> 'same-id',transport:()=>null});
    const result=await queue.enqueue({conversationId:'c',text:'hello'});
    assert.equal(result?.requestId,'same-id');assert.equal(queue.list()[0].requestId,'same-id');queue.dispose();
    const restored=createOutbox({store,newId:()=> 'unused',transport:()=>({deviceId:async()=> 'device',target:async()=>({sessionId:'session'}),submission:async()=>{throw {status:404};},submit:async(input)=>{submits.push(input.requestId);return {requestId:input.requestId,status:'accepted'};}})});
    await restored.resume();
    if(!wrote){assert.equal(submits.length,0);assert.equal(restored.list()[0].state,'unconfirmed');await restored.retry('same-id');await new Promise(resolve=>setImmediate(resolve));}
    assert.deepEqual(submits,['same-id']);restored.dispose();
  }
});


test('a queued concurrent save cannot resurrect a verified discarded request',async()=>{
  let disk:OutboxItem[]=[],hold=false,broken=false,release!:()=>void,entered!:()=>void,ids=0;
  const gate=new Promise<void>(done=>{release=done;});const started=new Promise<void>(done=>{entered=done;});
  const store={load:async()=>structuredClone(disk),save:async(items:OutboxItem[])=>{
    if(broken)throw new Error('rollback unavailable');
    if(hold&&items.length===0){entered();await gate;}
    disk=structuredClone(items);
    if(items.some(i=>i.requestId==='second')){broken=true;throw new Error('readback unavailable');}
  }};
  const queue=createOutbox({store,newId:()=>++ids===1?'first':'second',transport:()=>null});
  await queue.enqueue({conversationId:'a',text:'remove me'});hold=true;
  const discard=queue.discard('first');await started;
  const second=queue.enqueue({conversationId:'b',text:'pending'});
  const rejected=assert.rejects(second,{code:'PERSISTENCE_UNCONFIRMED',requestId:'second'});
  await Promise.resolve();release();await discard;await rejected;
  assert.equal(queue.list().some(i=>i.requestId==='first'),false);
  assert.equal(disk.some(i=>i.requestId==='first'),false);
  queue.dispose();
});

test('legacy queued and sending records without persistence markers keep receipt-first recovery',async()=>{
  for(const state of ['queued','sending'] as const) {
    const saved:OutboxItem[]=[{requestId:'legacy',conversationId:'chief',text:'hello',attachments:[],createdAt:1,state,attempts:0,deviceId:'device-1',sessionId:'s1'}];
    const f=fixture({receipt:id=>({requestId:id,status:'accepted'})},saved);
    await f.outbox.resume();assert.deepEqual(f.calls,['receipt:legacy']);assert.equal(f.outbox.list()[0].state,'sent');f.outbox.dispose();
  }
});

test('early canonical evidence is scoped to the exact request, conversation and Session',async()=>{
 for(const mismatch of ['request','conversation','session']){
  let accept:any;const f=fixture({receipt:()=>new Promise(resolve=>{accept=resolve;})});
  await f.outbox.enqueue({conversationId:'chief',text:'scoped'});await f.settle();
  await f.outbox.settle(mismatch==='conversation'?'other':'chief',[{role:'user',requestId:mismatch==='request'?'other':'r1',sessionId:mismatch==='session'?'other':'s1'}]);
  accept({requestId:'r1',conversationId:'chief',sessionId:'s1',status:'accepted'});await f.settle();
  assert.equal(f.outbox.list()[0].state,'sent',mismatch);
  await f.outbox.settle('chief',[{role:'user',requestId:'r1',sessionId:'other'}]);assert.equal(f.outbox.list().length,1,'wrong Session must never settle even an accepted send');
  await f.outbox.settle('chief',[{role:'user',requestId:'r1',sessionId:'s1'}]);assert.deepEqual(f.outbox.list(),[]);f.outbox.dispose();
 }
});
test('early evidence never clears unconfirmed persistence, crosses outbox owners or acts after disposal',async()=>{
 let accept:any;const f=fixture({receipt:()=>new Promise(resolve=>{accept=resolve;})});
 await f.outbox.enqueue({conversationId:'chief',text:'old owner'});await f.settle();await f.outbox.settle('chief',[{role:'user',requestId:'r1',sessionId:'s1'}]);
 f.outbox.dispose();accept({requestId:'r1',status:'accepted'});await f.settle();assert.equal(f.outbox.list()[0].state,'sending');
 const other=fixture();await other.outbox.enqueue({conversationId:'chief',text:'new owner'});await other.settle();assert.equal(other.outbox.list()[0].state,'sent','same IDs in a different owner need their own transcript evidence');other.outbox.dispose();
 const saved:OutboxItem[]=[{requestId:'persisted',conversationId:'chief',sessionId:'s1',deviceId:'device-1',text:'uncertain',attachments:[],state:'sent',persistence:'unconfirmed',attempts:0,createdAt:1}];
 const uncertain=fixture({receipt:id=>({requestId:id,status:'accepted'})},saved);await uncertain.outbox.load();
 await uncertain.outbox.settle('chief',[{role:'user',requestId:'persisted',sessionId:'s1'}]);assert.equal(uncertain.outbox.list()[0].state,'unconfirmed');
 await uncertain.outbox.retry('persisted');await uncertain.settle();assert.equal(uncertain.outbox.list()[0].state,'sent','unconfirmed persistence must not retain settlement evidence');uncertain.outbox.dispose();
});
test('local accepted placeholders, streaming and local delivery rows never become canonical settlement evidence',async()=>{
 for(const flags of [{localSubmission:true},{pending:true},{delivery:'sending' as const},{role:'assistant'}]){
  let accept:any;const f=fixture({receipt:()=>new Promise(resolve=>{accept=resolve;})});
  await f.outbox.enqueue({conversationId:'chief',text:'not canonical'});await f.settle();
  const placeholder={requestId:'r1',sessionId:'s1',role:'user',...flags};
  await f.outbox.settle('chief',[placeholder]);accept({requestId:'r1',status:'accepted'});await f.settle();
  assert.equal(f.outbox.list().length,1,JSON.stringify(flags));
  await f.outbox.settle('chief',[placeholder]);assert.equal(f.outbox.list().length,1,'late placeholder must not settle either');
  await f.outbox.settle('chief',[{role:'user',requestId:'r1',sessionId:'s1'}]);assert.deepEqual(f.outbox.list(),[]);f.outbox.dispose();
 }
});
