import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdapter } from '../src/adapter.mjs'

// The team's DSH Agent through the reviewed Agent contract (agents: 1). Every
// Agent route needs the owner's per-device grant, passed in as `access`.
const contract = { version: 1, stableRequestId: true, redactedText: true, groups: true, groupProjection: 1, agents: 1 }
const agent = { id: 'synthetic-agent', name: 'DSH Agent', sessions: ['agent-old', 'agent-session'] }
const conversationId = `agent:${agent.id}:agent-session`
const allowed = { agents: true }, denied = { agents: false }
const signal = () => AbortSignal.timeout(5000)

async function fixture(t, { description = contract, open = { agentId: agent.id, sessionId: 'agent-session' }, gate } = {}) {
  const calls = [], reads = []
  const state = { revision: 1, bots: [{ id: 'chief', name: 'Chief', sessionId: 'bot-session', parts: [] }], rooms: [], agents: [structuredClone(agent)] }
  const adapter = createAdapter({
    connection: { createSharedFetchHandler: () => ({ fetch: async request => {
      const { endpoint, payload } = await request.json()
      calls.push({ endpoint, payload })
      if (endpoint === 'state') { await gate?.(); return Response.json({ ok: true, value: state }) }
      if (endpoint === 'bridge.describe') return Response.json({ ok: true, value: description })
      if (endpoint === 'bridge.redact') return Response.json({ ok: true, value: { texts: payload.texts.map(text => text.replaceAll('synthetic-known', '[redacted]')) } })
      if (endpoint === 'bridge.submit') return Response.json({ ok: true, value: { accepted: true, requestId: payload.requestId, sessionId: payload.expectedSessionId } })
      if (endpoint === 'bridge.agent-open') return Response.json({ ok: true, value: open })
      if (endpoint === 'bridge.agent-new') { state.agents[0].sessions.push('agent-new'); return Response.json({ ok: true, value: { agentId: payload.agentId, sessionId: 'agent-new' } }) }
      throw new Error(`Unexpected host call: ${endpoint}`)
    } }) },
    sessionController: {
      list: async () => ({ items: [{ sessionId: 'agent-session', updatedAt: 100, running: true }] }),
      async *follow(args) {
        reads.push(args.address.sessionId)
        yield { type: 'snapshot', cursor: 3, records: [
          { event: { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'list my repos' }] } } },
          { event: { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'token synthetic-known' }] } } } },
          { event: { type: 'tool/call', seq: 3, data: { name: 'shell', input: { command: 'cat ~/.secret' } } } }] }
        yield { type: 'event', event: { type: 'assistant/message', seq: 4, data: { message: { content: [{ type: 'text', text: 'done' }] } } } }
      },
      page: async () => ({ records: [] }),
    },
  })
  t.after(() => adapter.dispose())
  await adapter.initialize()
  return { adapter, calls, reads, state }
}

test('the host Agent contract is advertised, but nothing about the Agent reaches an ungranted phone', async t => {
  const { adapter, calls, reads } = await fixture(t)
  const caps = adapter.capabilities()
  assert.equal(caps.agents, true)
  assert.ok(caps.actions.includes('agent-open') && caps.actions.includes('agent-new'))
  for (const access of [undefined, denied]) {
    const state = await adapter.state(signal(), access)
    assert.deepEqual(state.agents, [])
    assert.equal(state.agentAccess, false)
    const list = await adapter.conversations(signal(), access)
    assert.equal(list.conversations.some(item => item.kind === 'agent'), false)
    assert.equal(JSON.stringify({ state, list }).includes(agent.id), false)
    await assert.rejects(adapter.target(conversationId, signal(), access), { code: 'CONVERSATION_NOT_FOUND' })
    await assert.rejects(adapter.history(conversationId, {}, signal(), access), { code: 'CONVERSATION_NOT_FOUND' })
    await assert.rejects(adapter.submit({ conversationId, sessionId: 'agent-session', requestId: 'r', text: 'hi' }, signal(), access), { code: 'CONVERSATION_NOT_FOUND' })
    await assert.rejects(adapter.follow(conversationId, {}, signal(), access).next(), { code: 'CONVERSATION_NOT_FOUND' })
    for (const name of ['agent-open', 'agent-new']) await assert.rejects(adapter.action(name, {}, signal(), access), { code: 'AGENT_ACCESS_REQUIRED' })
  }
  assert.equal(calls.some(call => ['bridge.submit', 'bridge.agent-open', 'bridge.agent-new'].includes(call.endpoint)), false)
  assert.deepEqual(reads, [])
})

test('older or partial host contracts never enable the Agent, even for a granted phone', async t => {
  for (const description of [{ ...contract, agents: true }, { ...contract, agents: 2 }, { ...contract, redactedText: false }, { ...contract, stableRequestId: false }, { version: 1, agents: 1 }]) {
    const { adapter, calls } = await fixture(t, { description })
    assert.notEqual(adapter.capabilities().agents, true)
    assert.equal((adapter.capabilities().actions ?? []).includes('agent-open'), false)
    assert.deepEqual((await adapter.state(signal(), allowed)).agents, [])
    await assert.rejects(adapter.action('agent-open', {}, signal(), allowed), { code: 'AGENT_ACCESS_REQUIRED' })
    assert.equal(calls.some(call => call.endpoint === 'bridge.agent-open'), false)
  }
})

test('a granted phone lists each live Agent Session and chats in plain, redacted text', async t => {
  const { adapter, calls } = await fixture(t)
  const state = await adapter.state(signal(), allowed)
  assert.equal(state.agentAccess, true)
  assert.deepEqual(state.agents, [{ id: agent.id, name: 'DSH Agent', sessions: ['agent-old', 'agent-session'] }])
  const listed = (await adapter.conversations(signal(), allowed)).conversations.filter(item => item.kind === 'agent')
  assert.deepEqual(listed.map(item => item.id), [`agent:${agent.id}:agent-old`, conversationId])
  assert.equal(listed[1].busy, true)
  assert.deepEqual(await adapter.target(conversationId, signal(), allowed), { conversationId, sessionId: 'agent-session', revision: 1, kind: 'agent' })

  const page = await adapter.history(conversationId, {}, signal(), allowed)
  assert.deepEqual(page.messages.map(row => [row.role, row.text]), [['user', 'list my repos'], ['assistant', 'token [redacted]']])
  assert.equal(JSON.stringify(page).includes('cat ~/.secret'), false)
  const redaction = calls.filter(call => call.endpoint === 'bridge.redact').at(-1)
  assert.equal(redaction.payload.conversationId, `agent:${agent.id}`)
  assert.equal(redaction.payload.expectedSessionId, 'agent-session')

  const receipt = await adapter.submit({ conversationId, sessionId: 'agent-session', requestId: 'device_r1', text: 'hello' }, signal(), allowed)
  assert.equal(receipt.accepted, true)
  assert.deepEqual(calls.find(call => call.endpoint === 'bridge.submit').payload,
    { version: 1, conversationId: `agent:${agent.id}`, expectedSessionId: 'agent-session', requestId: 'device_r1', content: [{ type: 'text', text: 'hello' }] })
  await assert.rejects(adapter.submit({ conversationId, sessionId: 'agent-old', requestId: 'r2', text: 'hello' }, signal(), allowed), { code: 'TARGET_CHANGED' })
  await assert.rejects(adapter.submit({ conversationId, sessionId: 'agent-session', requestId: 'r3', text: 'see dsh-session:bot-session' }, signal(), allowed), { code: 'INVALID_CONTENT' })
  await assert.rejects(adapter.submit({ conversationId, sessionId: 'agent-session', requestId: 'r4', text: 'x', attachments: [{ receiptId: 'a' }] }, signal(), allowed), { code: 'INVALID_CONTENT' })
})

test('forged Agent ids and Bot Sessions cannot pass as Agent conversations', async t => {
  const { adapter } = await fixture(t)
  for (const id of [`agent:${agent.id}:bot-session`, `agent:${agent.id}:unknown`, `agent:other:agent-session`, `agent:${agent.id}`, 'agent-session', `agent:${agent.id}:agent-session:x`])
    await assert.rejects(adapter.target(id, signal(), allowed), { code: 'CONVERSATION_NOT_FOUND' }, id)
  const cursor = Buffer.from(JSON.stringify({ v: 1, conversationId, sessionId: 'bot-session' })).toString('base64url')
  await assert.rejects(adapter.history(conversationId, { cursor }, signal(), allowed), { code: 'SESSION_DENIED' })
})

test('opening the Agent takes no client input and returns only a listed conversation', async t => {
  const { adapter, calls } = await fixture(t)
  assert.deepEqual(await adapter.action('agent-open', {}, signal(), allowed), { conversationId, agentId: agent.id, sessionId: 'agent-session' })
  assert.deepEqual(calls.find(call => call.endpoint === 'bridge.agent-open').payload, {})
  for (const payload of [{ workspaceId: 'w' }, { sessionId: 's' }, { permissions: ['all'] }, null, []])
    await assert.rejects(adapter.action('agent-open', payload, signal(), allowed), { code: 'INVALID_ACTION' })
  for (const payload of [{}, { agentId: 'other' }, { agentId: agent.id, workspaceId: 'w' }])
    await assert.rejects(adapter.action('agent-new', payload, signal(), allowed), { code: /INVALID_ACTION|TARGET_DENIED/ })
  assert.deepEqual(await adapter.action('agent-new', { agentId: agent.id }, signal(), allowed), { conversationId: `agent:${agent.id}:agent-new`, agentId: agent.id, sessionId: 'agent-new' })
  assert.deepEqual(calls.filter(call => call.endpoint === 'bridge.agent-new').map(call => call.payload), [{ agentId: agent.id }])

  // A host result naming a Session outside the Agent is not handed to the phone.
  const stray = await fixture(t, { open: { agentId: agent.id, sessionId: 'bot-session' } })
  await assert.rejects(stray.adapter.action('agent-open', {}, signal(), allowed), { code: 'CONVERSATION_NOT_FOUND' })
})

test('removing the grant ends a live Agent stream at its next frame', async t => {
  const { adapter } = await fixture(t)
  let access = allowed
  const stream = adapter.follow(conversationId, {}, signal(), () => access)
  const reset = (await stream.next()).value
  assert.equal(reset.type, 'reset')
  assert.deepEqual(reset.messages.map(row => row.text), ['list my repos', 'token [redacted]'])
  access = denied
  await assert.rejects(stream.next(), { code: 'CONVERSATION_NOT_FOUND' })
})

test('the owner grants the Agent per phone on the computer; other and re-paired phones stay denied', async t => {
  const { createMobileServer } = await import('../src/server.js')
  const { MobileClient, MemoryTokenStore } = await import('../../../ios-app/sdk/index.js')
  const { mkdir, mkdtemp } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const { adapter } = await fixture(t)
  const base = resolve(import.meta.dirname, '../fixture/test-homes')
  await mkdir(base, { recursive: true })
  const server = await createMobileServer({ home: await mkdtemp(`${base}/agent-grant-`), config: { port: 0, devAllowInsecure: true }, adapter })
  t.after(() => server.close())
  async function pair(name) {
    const client = new MobileClient({ baseUrl: server.url, allowInsecure: true, tokenStore: new MemoryTokenStore() })
    t.after(() => client.dispose())
    const claim = await client.pair((await server.operator('pairing.create')).code, name)
    await server.operator('pairing.approve', { requestId: claim.requestId })
    return { client, session: await client.completePairing(claim.claimToken) }
  }
  const phone = await pair('Phone'), other = await pair('Other phone')
  const agentRows = async client => (await client.conversations()).conversations.filter(item => item.kind === 'agent')
  for (const { client } of [phone, other]) {
    assert.equal((await client.state()).agentAccess, false)
    assert.deepEqual(await agentRows(client), [])
    await assert.rejects(client.action('agent-open', {}), { code: 'AGENT_ACCESS_REQUIRED', status: 403 })
  }
  // A phone cannot grant itself: the grant is an owner operator request only.
  assert.equal((await phone.client.devices()).devices.every(device => device.agents === false), true)
  const granted = await server.operator('device.agents', { id: phone.session.deviceId, enabled: true })
  assert.equal(granted.agents, true)
  assert.equal((await phone.client.state()).agentAccess, true)
  assert.equal((await agentRows(phone.client)).length, 2)
  assert.equal((await phone.client.action('agent-open', {})).conversationId, conversationId)
  assert.deepEqual(await agentRows(other.client), [])
  await assert.rejects(other.client.target(conversationId), { code: 'CONVERSATION_NOT_FOUND' })
  await server.operator('device.agents', { id: phone.session.deviceId, enabled: false })
  assert.deepEqual(await agentRows(phone.client), [])
  await assert.rejects(phone.client.target(conversationId), { code: 'CONVERSATION_NOT_FOUND' })
  await assert.rejects(server.operator('device.agents', { id: phone.session.deviceId, enabled: 'yes' }), { code: 'INVALID_GRANT' })
  // Re-pairing creates a new device record, which starts without the grant.
  await server.operator('device.agents', { id: phone.session.deviceId, enabled: true })
  const again = await pair('Phone')
  assert.equal((await again.client.state()).agentAccess, false)
})

test('a grant removed while a request is in flight stops it before the host and before Agent text leaves', async t => {
  const { adapter, calls } = await fixture(t)
  // Allowed for the target lookup, removed before dispatch or release.
  const flipping = () => { let reads = 0; return () => (reads++ < 1 ? allowed : denied) }
  await assert.rejects(adapter.submit({ conversationId, sessionId: 'agent-session', requestId: 'r', text: 'hi' }, signal(), flipping()), { code: 'CONVERSATION_NOT_FOUND' })
  assert.equal(calls.some(call => call.endpoint === 'bridge.submit'), false)
  await assert.rejects(adapter.history(conversationId, {}, signal(), flipping()), { code: 'CONVERSATION_NOT_FOUND' })
  let reads = 0
  await assert.rejects(adapter.action('agent-open', {}, signal(), () => (reads++ < 1 ? allowed : denied)), { code: 'AGENT_ACCESS_REQUIRED' })
  assert.equal(calls.some(call => call.endpoint === 'bridge.agent-open'), false)
})

test('removing the grant on the computer aborts that phone\'s requests waiting on the host', async t => {
  const { createMobileServer } = await import('../src/server.js')
  const { MobileClient, MemoryTokenStore } = await import('../../../ios-app/sdk/index.js')
  const { mkdir, mkdtemp } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  let hold = null
  const { adapter, calls } = await fixture(t, { gate: () => hold?.promise })
  const base = resolve(import.meta.dirname, '../fixture/test-homes')
  await mkdir(base, { recursive: true })
  const server = await createMobileServer({ home: await mkdtemp(`${base}/agent-abort-`), config: { port: 0, devAllowInsecure: true }, adapter })
  t.after(() => server.close())
  const client = new MobileClient({ baseUrl: server.url, allowInsecure: true, tokenStore: new MemoryTokenStore() })
  t.after(() => client.dispose())
  const claim = await client.pair((await server.operator('pairing.create')).code, 'Phone')
  await server.operator('pairing.approve', { requestId: claim.requestId })
  const { deviceId } = await client.completePairing(claim.claimToken)
  await server.operator('device.agents', { id: deviceId, enabled: true })
  let release
  hold = { promise: new Promise(done => { release = done }) }
  const pending = client.submit({ conversationId, sessionId: 'agent-session', requestId: 'held_1', text: 'hello' })
  await new Promise(done => setTimeout(done, 100))
  await server.operator('device.agents', { id: deviceId, enabled: false })
  hold = null; release()
  // Refused either by the abort (403) or by the grant re-read before dispatch (404).
  await assert.rejects(pending, error => [403, 404].includes(error.status))
  assert.equal(calls.some(call => call.endpoint === 'bridge.submit'), false)
})
