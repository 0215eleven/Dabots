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
  await f.outbox.settle('chief', [{ requestId: 'other' }]);
  assert.equal(f.outbox.list().length, 1);
  await f.outbox.settle('chief', [{ requestId: 'r1' }]);
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
