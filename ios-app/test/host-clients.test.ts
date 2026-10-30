import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostClients } from '../src/session/host-clients.ts';

function fakeClient(name: string) { return { name, disposed: 0, dispose() { this.disposed++; } }; }
const office = { url: 'https://office', serverId: 'office', name: 'Office', slot: 'a' };
const home = { url: 'https://home', serverId: 'home', name: 'Home', slot: 'b' };

test('one client per computer is shared and disposed with its last lease', async () => {
  const opened: string[] = [];
  const clients = createHostClients(async host => { opened.push(host.serverId); return fakeClient(host.serverId) as any; });
  const [first, second] = await Promise.all([clients.acquire(office), clients.acquire(office)]);
  assert.equal(first.client, second.client, 'the session and a watcher share one client');
  assert.deepEqual(opened, ['office'], 'concurrent acquires open the computer once');
  first.release(); first.release();
  assert.equal((second.client as any).disposed, 0, 'a repeated release does not drop another lease');
  second.release();
  assert.equal((second.client as any).disposed, 1);
  const third = await clients.acquire(office);
  assert.notEqual(third.client, first.client, 'a released computer opens a fresh client');
  assert.deepEqual(opened, ['office', 'office']);
});

test('computers do not share clients and a failed open can be retried', async () => {
  let fail = true;
  const clients = createHostClients(async host => { if (host.serverId === 'home' && fail) throw new Error('offline'); return fakeClient(host.serverId) as any; });
  const a = await clients.acquire(office);
  await assert.rejects(clients.acquire(home), /offline/);
  fail = false;
  const b = await clients.acquire(home);
  assert.notEqual(a.client, b.client);
  assert.equal(clients.peek(home), b.client);
});

test('a new pairing is adopted as the shared client and replaces a stale one', async () => {
  const clients = createHostClients(async () => fakeClient('opened') as any);
  const watcher = await clients.acquire(office);
  const paired = fakeClient('paired') as any;
  const session = clients.adopt(office, paired);
  assert.equal((watcher.client as any).disposed, 1, 'the stale client of the same pairing slot is closed');
  const next = await clients.acquire(office);
  assert.equal(next.client, paired);
  watcher.release();
  assert.equal(paired.disposed, 0, 'releasing the stale lease leaves the adopted client open');
  session.release(); next.release();
  assert.equal(paired.disposed, 1);
});
