import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdapter } from '../src/adapter.mjs'

// DSH's approval waterfall, as cordis composes it: prepended listeners run first, each may call
// next(); the end of the chain answers 'unavailable' (no computer answerer).
function waterfall() {
  const listeners = []
  return {
    on(name, listener, options) { assert.equal(name, 'approval/request'); if (options?.prepend) listeners.unshift(listener); else listeners.push(listener); return () => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); return index >= 0 } },
    ask(request) { const chain = [...listeners]; const next = () => (chain.shift() ?? (() => Promise.resolve('unavailable')))(request, next); return Promise.resolve(next()) },
    use(listener) { listeners.push(listener) },
  }
}
// A computer card: answers when told to, or 'cancelled' when its request signal aborts.
function card(hooks) {
  const shown = []
  hooks.use(request => new Promise(resolve => {
    const entry = { request, answer: resolve, closed: false }
    request.signal?.addEventListener('abort', () => { entry.closed = true; resolve('cancelled') }, { once: true })
    shown.push(entry)
  }))
  return shown
}
const tick = () => new Promise(resolve => setImmediate(resolve))
async function fixture(t, { grant = { approvals: true, agents: true }, available = true, room = [], rooms = [] } = {}) {
  const hooks = waterfall(), calls = []
  const state = { revision: 1, bots: [{ id: 'chief', name: 'Chief', sessionId: 'chat', parts: [] }], rooms, agents: [{ id: 'coder', name: 'Coder', sessions: ['agent-session'] }],
    work: { approvals: room } }
  const adapter = createAdapter({ fixtureText: true,
    connection: { createSharedFetchHandler: () => ({ fetch: async request => { const { endpoint, payload } = await request.json(); calls.push([endpoint, payload])
      return Response.json({ ok: true, value: endpoint === 'state' ? state : endpoint === 'bridge.redact' ? { texts: payload.texts } : endpoint === 'approval-answer' ? true : { version: 1, redactedText: true, stableRequestId: true, agents: 1, groups: true, groupProjection: 1 } }) } }) },
    sessionController: { cancel: async args => { calls.push(['cancel', args]) } },
    approvalHook: { on: hooks.on, available: () => available } })
  t.after(() => adapter.dispose())
  await adapter.initialize()
  return { adapter, hooks, calls, state, access: () => grant }
}
const signal = () => AbortSignal.timeout(3000)

test('a phone answer decides a Bot chat approval and closes the computer card', async t => {
  const f = await fixture(t), shown = card(f.hooks)
  const asked = f.hooks.ask({ agent: { session: { id: 'chat' } }, toolName: 'bash', reason: 'Run npm test', signal: new AbortController().signal })
  await tick(); await tick()
  const [request] = await f.adapter.approvals('chief', signal(), f.access)
  assert.deepEqual({ tool: request.tool, reason: request.reason, conversationId: request.conversationId }, { tool: 'bash', reason: 'Run npm test', conversationId: 'chief' })
  assert.equal(shown.length, 1, 'the computer card still appears')
  assert.deepEqual(await f.adapter.answerApproval(request.id, 'allow', signal(), f.access), { answered: true })
  assert.equal(await asked, 'allowed-once')
  assert.equal(shown[0].closed, true, 'the computer card is closed')
  assert.deepEqual(await f.adapter.approvals('chief', signal(), f.access), [])
  await assert.rejects(f.adapter.answerApproval(request.id, 'allow', signal(), f.access), { code: 'APPROVAL_CLOSED' })
})

test('the computer card still decides first, and without a window the phone is waited for', async t => {
  const f = await fixture(t), shown = card(f.hooks)
  const first = f.hooks.ask({ agent: { session: { id: 'chat' } }, toolName: 'bash', signal: new AbortController().signal })
  await tick(); await tick(); shown[0].answer('rejected')
  assert.equal(await first, 'rejected')
  assert.deepEqual(await f.adapter.approvals('chief', signal(), f.access), [])

  const g = await fixture(t)
  const waiting = g.hooks.ask({ agent: { session: { id: 'agent-session' } }, toolName: 'write', signal: new AbortController().signal })
  await tick(); await tick(); await tick()
  const [request] = await g.adapter.approvals('agent:coder:agent-session', signal(), g.access)
  assert.ok(request, 'a DSH Agent Session approval waits for the phone when no computer card answers')
  await g.adapter.answerApproval(request.id, 'reject', signal(), g.access)
  assert.equal(await waiting, 'rejected')
})

test('only an allowed phone sees or answers approvals; others pass through untouched', async t => {
  const f = await fixture(t, { grant: { approvals: false, agents: true } })
  const controller = new AbortController()
  const asked = f.hooks.ask({ agent: { session: { id: 'chat' } }, toolName: 'bash', signal: controller.signal })
  await tick(); await tick()
  assert.deepEqual(await f.adapter.approvals('chief', signal(), f.access), [])
  const [id] = [...JSON.stringify(await f.adapter.approvals('chief', signal(), () => ({ approvals: true }))).matchAll(/"id":"([^"]+)"/g)].map(match => match[1])
  await assert.rejects(f.adapter.answerApproval(id, 'allow', signal(), f.access), { code: 'APPROVALS_NOT_ALLOWED' })
  controller.abort()
  assert.equal(await asked, 'cancelled', 'stopping the turn cancels a waiting approval')

  const off = await fixture(t, { available: false })
  assert.equal(await off.hooks.ask({ agent: { session: { id: 'chat' } }, toolName: 'bash' }), 'unavailable', 'no allowed phone: DSH behaves as before')
  const member = await fixture(t)
  assert.equal(await member.hooks.ask({ agent: { session: { id: 'hidden-member' } }, toolName: 'bash' }), 'unavailable', 'group member Sessions stay with the engine')
})

test('group approvals are answered through the engine, and DSH Agent chats can be stopped', async t => {
  const f = await fixture(t, { rooms: [{ id: 'room1', name: 'Room', members: ['chief'], parts: ['member'], admin: 'chief' }],
    room: [{ id: 'ap-1', botId: 'chief', roomId: 'room1', sessionId: 'member', at: 1, answerable: true, tool: 'bash', reason: 'ls -la' }] })
  const listed = await f.adapter.approvals('room1', signal(), f.access)
  assert.deepEqual(listed.map(item => [item.id, item.botId, item.tool, item.reason]), [['ap-1', 'chief', 'bash', 'ls -la']])
  const state = await f.adapter.state(signal(), f.access)
  assert.deepEqual(state.work.approvals, [{ id: 'ap-1', botId: 'chief', roomId: 'room1', at: 1, answerable: false }], 'the shared state carries no tool or reason')
  assert.equal(state.approvalAccess, true)
  await f.adapter.answerApproval('ap-1', 'allow', signal(), f.access)
  assert.deepEqual(f.calls.find(call => call[0] === 'approval-answer'), ['approval-answer', { id: 'ap-1', choice: 'allow' }])
  await assert.rejects(f.adapter.answerApproval('ap-1', 'maybe', signal(), f.access), { code: 'INVALID_CHOICE' })
  // Agent stop goes straight to the Session.
  assert.deepEqual(await f.adapter.cancel('agent:coder:agent-session', signal(), f.access), { conversationId: 'agent:coder:agent-session', sessionId: 'agent-session', queueCleared: false })
  assert.deepEqual(f.calls.find(call => call[0] === 'cancel'), ['cancel', { sessionId: 'agent-session' }])
  await assert.rejects(f.adapter.cancel('agent:coder:agent-session', signal(), () => ({ agents: false })), { code: 'CONVERSATION_NOT_FOUND' })
})
