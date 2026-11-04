import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/channel.js'

// Exercise the real registered channel at its public Fetch boundary. The fixture
// owns only persistence, capability admission and the Session prompt service.
function channel({ prepare = async () => {}, locked = false } = {}) {
  let route, current = 'current'
  const submitted = [], renamed = []
  const state = {
    bots: { chief: { id: 'chief' } },
    rooms: { room: { id: 'room', members: ['chief'], admin: 'chief', mode: 'admin' } },
    agents: { helper: { id: 'helper', sessions: ['agent-current'] } },
  }
  const rt = {
    state, load: async () => {}, refresh: async () => {}, loadSecrets: async () => {},
    readOnly: () => locked ? 'Held by another host' : undefined,
    chatOf: () => current,
    botOf: id => state.bots[id],
    selfOf: id => id === 'current' ? { botId: 'chief' } : undefined,
    roomOf: id => state.rooms[id], groupOwners: new Map([['hidden', { roomId: 'room' }]]),
    redactSecrets: text => text.replaceAll('fixture-private-value', '[secret:fixture]'),
    ensureCapabilities: async () => prepare({ state, move: () => { current = 'next' } }),
    resolveAgent: async () => {},
    createAgentSession: async id => { state.agents[id].sessions.push('agent-new'); return 'agent-new' },
    noteFailure: error => { throw Error(`Unexpected internal failure: ${error.text}`) },
    ctx: {
      effect: fn => fn(),
      connection: { fetch: { register: value => { route = value; return () => {} } } },
      sessionController: { prompt: async value => { submitted.push(value); return { accepted: true } }, rename: async value => { renamed.push(value); return { title: value.title, seq: 9 } } },
    },
  }
  install(rt)
  const call = async (endpoint, payload, signal) => (await route.fetch(new Request('http://localhost/api/bot', {
    method: 'POST', body: JSON.stringify({ endpoint, payload }), ...(signal ? { signal } : {}),
  }))).json()
  return { call, state, submitted, renamed }
}

const message = fields => ({ version: 1, conversationId: 'chief', expectedSessionId: 'current', requestId: 'mobile_1', content: [{ type: 'text', text: 'hello' }], ...fields })

test('the production engine advertises the reliable redacted mobile contract', async () => {
  const { call } = channel({ locked: true })
  const response = await call('bridge.describe')
  assert.deepEqual(response, { ok: true, value: { version: 1, stableRequestId: true, redactedText: true, groups: true, groupProjection: 1, attachments: false, agents: 1, agentRename: 1 } })
})

test('redaction returns only owned conversation text and refuses stale sessions', async () => {
  const { call } = channel()
  const payload = { conversationId: 'chief', expectedSessionId: 'current', texts: ['hello fixture-private-value'] }
  assert.deepEqual(await call('bridge.redact', payload), { ok: true, value: { texts: ['hello [secret:fixture]'] } })
  assert.equal((await call('bridge.redact', { ...payload, expectedSessionId: 'hidden' })).error.code, 'bot/stale')
  assert.equal((await call('bridge.redact', { ...payload, texts: Array(201).fill('x') })).error.code, 'bot/invalid')
})

test('submission forwards its stable request ID to the public Session queue', async () => {
  const { call, submitted } = channel()
  assert.deepEqual(await call('bridge.submit', message()), { ok: true, value: { accepted: true, requestId: 'mobile_1', sessionId: 'current' } })
  assert.deepEqual(submitted, [{ requestId: 'mobile_1', sessionId: 'current', mode: 'queue', content: [{ type: 'text', text: 'hello' }] }])
})

test('malformed conversation IDs never queue a message or cause an internal error', async () => {
  const { call, submitted } = channel()
  for (const conversationId of [null, 4, '', '__proto__', 'constructor']) {
    const result = await call('bridge.submit', message({ conversationId }))
    assert.equal(result.ok, false)
    assert.ok(['bot/invalid', 'bot/stale'].includes(result.error.code), result.error.code)
  }
  assert.equal(submitted.length, 0)
})

test('a stale or hidden target cannot be submitted through a Bot conversation', async () => {
  const { call, submitted } = channel()
  for (const expectedSessionId of ['old', 'hidden', 'agent-current']) {
    assert.equal((await call('bridge.submit', message({ expectedSessionId }))).error.code, 'bot/stale')
  }
  assert.equal(submitted.length, 0)
})

test('attachment admission independently bounds file count, bytes and text parts', async () => {
  const { call, submitted } = channel()
  const part = { type: 'file-upload', name: 'synthetic.txt', mediaType: 'text/plain', data: 'b2s=' }
  for (const content of [Array(5).fill(part), [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], [{ ...part, name: '../outside.txt' }], [{ ...part, data: Buffer.alloc(2097153).toString('base64') }]]) {
    assert.equal((await call('bridge.submit', message({ content }))).error.code, 'bot/invalid')
  }
  assert.equal(submitted.length, 0)
})

test('a rotated Bot session is rechecked after capability admission', async () => {
  const { call, submitted } = channel({ prepare: async ({ move }) => move() })
  assert.equal((await call('bridge.submit', message())).error.code, 'bot/stale')
  assert.equal(submitted.length, 0)
})

test('changed group membership is rechecked after capability admission', async () => {
  const { call, submitted } = channel({ prepare: async ({ state }) => { state.rooms.room.members = [] } })
  const result = await call('bridge.submit', message({ conversationId: 'room', expectedSessionId: 'room', expectedMembers: ['chief'] }))
  assert.equal(result.error.code, 'bot/stale')
  assert.equal(submitted.length, 0)
})

test('read-only teams and cancelled requests cannot enqueue work', async () => {
  const locked = channel({ locked: true })
  assert.equal((await locked.call('bridge.submit', message())).error.code, 'bot/read-only')
  assert.equal(locked.submitted.length, 0)
  const active = channel(), controller = new AbortController()
  controller.abort()
  assert.equal((await active.call('bridge.submit', message(), controller.signal)).ok, false)
  assert.equal(active.submitted.length, 0)
})

test('the mobile Agent entry reuses its owned live session and creates a new one explicitly', async () => {
  const { call } = channel()
  assert.deepEqual(await call('bridge.agent-open'), { ok: true, value: { agentId: 'helper', sessionId: 'agent-current' } })
  assert.deepEqual(await call('bridge.agent-new', { agentId: 'helper' }), { ok: true, value: { agentId: 'helper', sessionId: 'agent-new' } })
  assert.equal((await call('bridge.agent-new', { agentId: 'constructor' })).error.code, 'bot/stale')
})

test('mobile Agent renaming uses the durable user-title service only for its owned session', async () => {
  const { call, renamed } = channel()
  assert.equal((await call('bridge.describe')).value.agentRename, 1)
  assert.deepEqual(await call('bridge.agent-rename', { agentId: 'helper', sessionId: 'agent-current', title: '  Manual title  ' }), { ok: true, value: { title: 'Manual title', seq: 9 } })
  for (const payload of [{agentId:'helper',sessionId:'current',title:'wrong'}, {agentId:'other',sessionId:'agent-current',title:'wrong'}, {agentId:'helper',sessionId:'agent-current',title:' '}, {agentId:'helper',sessionId:'agent-current',title:'x\ny'}, {agentId:'helper',sessionId:'agent-current',title:'x'.repeat(81)}, {agentId:'helper',sessionId:'agent-current',title:'x',workspaceId:'foreign'}])
    assert.equal((await call('bridge.agent-rename',payload)).ok,false)
  assert.deepEqual(renamed,[{sessionId:'agent-current',title:'Manual title'}])
  assert.equal((await channel({locked:true}).call('bridge.agent-rename',{agentId:'helper',sessionId:'agent-current',title:'x'})).error.code,'bot/read-only')
})

test('a hidden group session cannot be smuggled into the Agent ownership list', async () => {
  const { call, state, submitted } = channel()
  state.agents.helper.sessions.push('hidden')
  assert.equal((await call('bridge.submit', message({ conversationId: 'agent:helper', expectedSessionId: 'hidden' }))).error.code, 'bot/stale')
  assert.equal((await call('bridge.redact', { conversationId: 'agent:helper', expectedSessionId: 'hidden', texts: ['fixture-private-value'] })).error.code, 'bot/stale')
  assert.equal(submitted.length, 0)
})
