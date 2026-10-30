import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeerWatcher, peerRows, type PeerState } from '../src/logic/peer-hosts.ts';

const now = Date.parse('2026-10-30T12:00:00Z');
function client(serverId = 'home') {
  const calls: string[] = [];
  return { calls, value: {
    info: async () => ({ serverId, capabilities: { history: true } }),
    state: async () => ({ bots: [{ id: 'b1', name: 'Ops', role: 'Servers' }, { id: 'b2', name: 'Hidden', hidden: true }], rooms: [{ id: 'r1', name: 'Team', members: ['b1'] }], models: [] }),
    conversations: async () => ({ conversations: [
      { id: 'b1', kind: 'bot', name: 'Ops', sessionId: 's1', updatedAt: now - 60_000 },
      { id: 'r1', kind: 'room', name: 'Team', sessionId: 's2', updatedAt: now - 3_600_000 },
    ] }),
    messages: async (id: string) => { calls.push(id); return { messages: [{ id: 'm', sessionId: 's', seq: 1, role: 'assistant', text: `latest ${id}`, createdAt: now - 30_000 }], cursor: null, sessionId: 's' }; },
  } as any };
}

test('a watched computer publishes its chats, previews and online state', async () => {
  const states: PeerState[] = [];
  const cache = new Map<string, unknown>();
  const { value, calls } = client();
  const watcher = createPeerWatcher({ serverId: 'home', client: value, readCache: async (id, key) => cache.get(`${id}:${key}`) ?? null, writeCache: async (id, key, v) => { cache.set(`${id}:${key}`, v); }, onChange: s => states.push(s) });
  await watcher.start();
  const state = watcher.state;
  assert.equal(state.online, true);
  assert.equal(state.previews.b1.text, 'latest b1');
  assert.ok(cache.has('home:team') && cache.has('home:conversations'), 'the cache keeps the list for offline starts');
  await watcher.refresh();
  assert.deepEqual(calls.sort(), ['b1', 'r1'], 'unchanged conversations are not read again');
  const rows = peerRows(state, bot => bot.id === 'b1' ? '#4D6BFE' : null);
  assert.deepEqual(rows.map(r => [r.kind, r.name, r.preview]), [['bot', 'Ops', 'latest b1'], ['group', 'Team', 'latest r1']]);
  assert.equal(rows[0].id, 'ds:home:bot:b1', 'rows open the same DS identity as the chat route');
  assert.deepEqual(rows[1].avatar.members, [{ seed: 'b1', color: '#4D6BFE' }]);
  assert.ok(!rows.some(r => r.name === 'Hidden'), 'hidden chats stay hidden');
});

test('a computer that answers as another one, or fails, shows offline', async () => {
  let fails = false;
  const { value } = client('other');
  const watcher = createPeerWatcher({ serverId: 'home', client: { ...value, state: async () => { if (fails) throw new Error('timeout'); return value.state(); } }, readCache: async () => null, writeCache: async () => {}, onChange: () => {} });
  await watcher.refresh();
  assert.equal(watcher.state.online, false);
  assert.match(watcher.state.error, /another computer/);
  fails = true;
  await watcher.refresh();
  assert.equal(watcher.state.error, 'timeout');
});

test('an offline computer still lists its cached chats', async () => {
  const cache = new Map<string, unknown>([['home:team', { bots: [{ id: 'b1', name: 'Ops' }], rooms: [] }], ['home:conversations', [{ id: 'b1', kind: 'bot', name: 'Ops', sessionId: 's1', updatedAt: now }]]]);
  const watcher = createPeerWatcher({ serverId: 'home', client: { state: async () => { throw new Error('offline'); }, conversations: async () => ({ conversations: [] }), info: async () => ({ serverId: 'home' }) } as any,
    readCache: async (id, key) => cache.get(`${id}:${key}`) ?? null, writeCache: async () => {}, onChange: () => {} });
  await watcher.start();
  assert.equal(watcher.state.online, false);
  assert.deepEqual(peerRows(watcher.state, () => null).map(r => r.name), ['Ops']);
});
