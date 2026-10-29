import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdapter } from '../src/adapter.mjs'

async function fixture(t) {
  const state = { revision: 1, bots: [{ id: 'a', name: 'A', sessionId: 'sa', parts: ['old'] }, { id: 'b', name: 'B', sessionId: 'sb' }],
    rooms: [{ id: 'room', name: 'Room', members: ['a'], parts: ['hidden'] }],
    activity: { a: 'thinking', b: 'secret-value', foreign: 'thinking' },
    work: { bots: { a: { since: 100, tool: 'private-tool', said: 'private text', roomId: 'room' }, b: { since: 90, roomId: 'foreign' } },
      rooms: { room: [{ botId: 'a', since: 100, speaking: true, target: '/private/path' }, { botId: 'b', since: 200 }], foreign: [{ botId: 'a' }] },
      approvals: [{ id: 'approval-1', botId: 'a', roomId: 'room', sessionId: 'hidden', at: 110, answerable: true, reason: 'private reason' },
        { id: 'foreign-approval', botId: 'b', roomId: 'room', sessionId: 'hidden' }, { id: 'wrong-session', botId: 'a', sessionId: 'sb' }],
      waiting: { a: { bots: ['b', 'foreign'], rooms: ['room', 'foreign'], for: ['b'] } } },
  }
  let rows = [{ sessionId: 'sa', updatedAt: 200, running: true, cwd: '/private/path', projections: { text: 'private text' } },
    { sessionId: 'old', updatedAt: 300, running: true }, { sessionId: 'hidden', updatedAt: 999 }, { sessionId: 'foreign', updatedAt: 999 }]
  const sessionController = { list: async () => ({ items: rows }), async *follow() { yield { type: 'snapshot', cursor: 5, records: [] } } }
  const adapter = createAdapter({ sessionController, connection: { createSharedFetchHandler: () => ({ fetch: async request => {
    const { endpoint, payload } = await request.json()
    return Response.json({ ok: true, value: endpoint === 'state' ? state : endpoint === 'bridge.describe'
      ? { version: 1, stableRequestId: true, redactedText: true, groups: true, groupProjection: 1 } : { texts: payload.texts } })
  } }) } })
  t.after(() => adapter.dispose())
  await adapter.initialize()
  return { adapter, state, sessionController, rows: value => { rows = value } }
}

test('state restores scoped work evidence without tool text, paths or hidden Sessions', async t => {
  const { adapter } = await fixture(t)
  const state = await adapter.state()
  assert.deepEqual(state.activity, { a: 'thinking' })
  assert.deepEqual(state.work.bots, { a: { since: 100, roomId: 'room' } })
  assert.deepEqual(state.work.rooms, { room: [{ botId: 'a', since: 100, speaking: true }] })
  assert.deepEqual(state.work.approvals, [{ id: 'approval-1', botId: 'a', roomId: 'room', at: 110, answerable: false }])
  assert.deepEqual(state.work.waiting, { a: { bots: ['b'], rooms: ['room'], for: ['b'] } })
  for (const secret of ['private', 'hidden', 'foreign', 'wrong-session']) assert.equal(JSON.stringify(state).includes(secret), false)
  assert.equal(adapter.capabilities().approvals, false)
  assert.equal(adapter.capabilities().notifications, false)
  assert.equal(adapter.capabilities().taskEvents, true)
  assert.equal(state.taskEvents.length, 1)
  assert.equal(state.taskEvents[0].conversationId, 'room')
  assert.equal(state.taskEvents[0].sessionId, 'room')
  assert.equal(state.taskEvents[0].taskEvent.kind, 'approval-required')
})

test('recent activity uses only current and prior visible Session metadata', async t => {
  const { adapter } = await fixture(t)
  const rows = (await adapter.conversations()).conversations
  const a = rows.find(row => row.id === 'a')
  assert.equal(a.updatedAt, 300)
  assert.equal(a.busy, true)
  assert.equal(a.approvalRequired, false, 'group approval does not belong to the own chat')
  const room = rows.find(row => row.id === 'room')
  assert.equal(room.busy, true)
  assert.equal(room.approvalRequired, true)
  assert.equal(room.updatedAt, undefined, 'hidden member timestamps must not order public rooms')
  for (const secret of ['private', 'hidden', 'foreign']) assert.equal(JSON.stringify(rows).includes(secret), false)
})

test('cold list refresh rechecks ownership after asynchronous metadata lookup', async t => {
  const f = await fixture(t)
  f.sessionController.list = async () => {
    f.state.bots[0].sessionId = 'new'
    f.state.bots[0].parts = []
    return { items: [{ sessionId: 'sa', updatedAt: 999, running: true }] }
  }
  const a = (await f.adapter.conversations()).conversations.find(row => row.id === 'a')
  assert.equal(a.sessionId, 'new')
  assert.equal(a.updatedAt, undefined)
  assert.equal(a.busy, false)
})

test('reconnect reset restores running state without replaying historical completion events', async t => {
  const f = await fixture(t)
  f.state.work.bots.a = { since: 100 }
  f.sessionController.follow = async function* () {
    yield { type: 'snapshot', cursor: 5, records: [{ event: { type: 'turn/end', seq: 3, data: { reason: { kind: 'completed' } } } }] }
  }
  const frames = []
  for await (const frame of f.adapter.follow('a', {}, AbortSignal.timeout(5000))) frames.push(frame)
  assert.equal(frames[0].type, 'reset')
  assert.equal(frames[0].busy, true)
  assert.equal(frames[0].phase, 'running')
  assert.equal(frames.some(frame => frame.taskEvent?.kind === 'completed'), false)
})

test('recent activity fails closed for invalid times and absent public list capability', async t => {
  const f = await fixture(t)
  f.rows([{ sessionId: 'sa', updatedAt: -1, running: 'yes' }, { sessionId: 'old', updatedAt: 'private' }])
  assert.equal((await f.adapter.conversations()).conversations[0].updatedAt, undefined)
  delete f.sessionController.list
  assert.equal((await f.adapter.conversations()).conversations[0].updatedAt, undefined)
})

test('production follow exposes precise terminal outcomes and skips hidden turns', async t => {
  const f = await fixture(t)
  f.state.exchangeTurns = { sa: [2] }
  f.sessionController.follow = async function* () {
    yield { type: 'snapshot', cursor: 1, records: [] }
    yield { type: 'event', event: { type: 'turn/end', seq: 2, time: 300, data: { turn: 1, reason: { kind: 'error', error: { message: 'private failure' } } } } }
    yield { type: 'event', event: { type: 'turn/end', seq: 3, time: 301, data: { turn: 2, reason: { kind: 'completed' } } } }
    yield { type: 'event', event: { type: 'turn/end', seq: 4, time: 302, data: { turn: 3, reason: { kind: 'completed' } } } }
  }
  const frames = []
  for await (const frame of f.adapter.follow('a', {}, AbortSignal.timeout(5000))) frames.push(frame)
  assert.deepEqual(frames.filter(frame => frame.taskEvent).map(frame => frame.taskEvent.kind), ['failed', 'completed'])
  assert.equal(JSON.stringify(frames).includes('private failure'), false)
})

test('approval polling removes settled requests and rejects stale own-chat Session requests', async t => {
  const f = await fixture(t)
  f.state.work.approvals = [{ id: 'own', botId: 'a', sessionId: 'sa', at: 500, reason: 'private' }]
  const first = await f.adapter.state()
  assert.equal(first.taskEvents[0].conversationId, 'a')
  assert.equal(first.taskEvents[0].taskEvent.id, (await f.adapter.state()).taskEvents[0].taskEvent.id)
  f.state.bots[0].sessionId = 'next'
  assert.deepEqual((await f.adapter.state()).taskEvents, [])
  f.state.work.approvals = []
  assert.deepEqual((await f.adapter.state()).work.approvals, [])
})

test('a public group stream ends while separately retaining member activity and approval evidence', async t => {
  const f = await fixture(t)
  f.sessionController.follow = async function* () {
    yield { type: 'event', event: { type: 'turn/end', seq: 4, time: 302, data: { turn: 3, reason: { kind: 'completed' } } } }
  }
  const frames = []
  for await (const frame of f.adapter.follow('room', {}, AbortSignal.timeout(5000))) frames.push(frame)
  assert.equal(frames[0].busy, false)
  assert.equal((await f.adapter.state()).work.rooms.room[0].botId, 'a')
  assert.equal(frames[0].approvalRequired, true)
  assert.equal(frames[0].taskEvent.kind, 'completed', 'the event describes only the public turn')
})

test('hidden collaboration turns update running status without publishing a task outcome', async t => {
  const f = await fixture(t)
  f.state.exchangeTurns = { sa: [2] }
  f.sessionController.follow = async function* () {
    yield { type: 'snapshot', cursor: 1, records: [] }
    yield { type: 'event', event: { type: 'turn/end', seq: 3, time: 301, data: { turn: 2, reason: { kind: 'error', error: { message: 'private' } } } } }
  }
  const frames = []
  for await (const frame of f.adapter.follow('a', {}, AbortSignal.timeout(5000))) frames.push(frame)
  assert.equal(frames[0].busy, true)
  assert.deepEqual(frames[1], { type: 'status', conversationId: 'a', sessionId: 'sa', busy: false, phase: 'idle' })
})

test('idle public group snapshots never latch member work into the stream running flag', async t => {
  const f = await fixture(t)
  f.rows([{ sessionId: 'room', running: false }])
  const frames = []
  for await (const frame of f.adapter.follow('room', {}, AbortSignal.timeout(5000))) frames.push(frame)
  assert.equal(frames[0].busy, false)
  assert.equal((await f.adapter.state()).work.rooms.room[0].botId, 'a')
  assert.equal(frames[0].approvalRequired, true)
})

test('reconnect observes a running public room before members have begun working', async t => {
  const f = await fixture(t)
  f.state.work = {}
  f.rows([{ sessionId: 'room', running: true, updatedAt: 300 }])
  const frames = []
  for await (const frame of f.adapter.follow('room', {}, AbortSignal.timeout(5000))) frames.push(frame)
  assert.equal(frames[0].busy, true)
})

test('reconnect refuses the old Session if the target rolls over during its public metadata read', async t => {
  const f = await fixture(t)
  f.sessionController.list = async () => {
    f.state.bots[0].sessionId = 'new'
    return { items: [{ sessionId: 'sa', running: true }] }
  }
  const frames = []
  for await (const frame of f.adapter.follow('a', {}, AbortSignal.timeout(5000))) frames.push(frame)
  assert.deepEqual(frames, [])
})
