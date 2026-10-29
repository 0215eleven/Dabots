import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdapter } from '../src/adapter.mjs'
import { detail } from '../src/projection.js'
import { redactor } from '../fixture/vanilla/package/src/host/secrets.js'

// Characterize the current closed boundary. These are not Agent support tests.
// The redactor above is the integrity-pinned public fixture from test:prepare.
const agent = { id: 'synthetic-agent', name: 'Private Agent label', sessions: ['synthetic-session'] }
const route = `agent:${agent.id}:${agent.sessions[0]}`
const contract = { version: 1, stableRequestId: true, redactedText: true, groups: true, groupProjection: 1 }
const signal = () => AbortSignal.timeout(5000)

async function fixture(t, description = contract) {
  const calls = [], sessionReads = []
  const state = { revision: 1, bots: [{ id: 'chief', name: 'Chief', sessionId: 'bot-session', parts: [] }],
    rooms: [{ id: 'room', name: 'Room', members: ['chief'] }], agents: [agent] }
  const adapter = createAdapter({
    connection: { createSharedFetchHandler: () => ({ fetch: async request => {
      const { endpoint, payload } = await request.json()
      calls.push({ endpoint, payload })
      if (endpoint === 'state') return Response.json({ ok: true, value: state })
      if (endpoint === 'bridge.describe') return Response.json({ ok: true, value: description })
      if (endpoint === 'bridge.redact') return Response.json({ ok: true, value: { texts: payload.texts } })
      throw new Error(`Unexpected host mutation: ${endpoint}`)
    } }) },
    sessionController: {
      list: async () => ({ items: [{ sessionId: agent.sessions[0], title: 'Private session title', updatedAt: 100 }] }),
      page: async args => { sessionReads.push(args); throw new Error('Unexpected Session page read') },
      follow(args) { sessionReads.push(args); throw new Error('Unexpected Session subscription') },
    },
  })
  t.after(() => adapter.dispose())
  await adapter.initialize()
  return { adapter, calls, sessionReads }
}

test('legacy or unreviewed Agent flags never grant Agent actions or expose Agent state', async t => {
  for (const description of [{}, contract, { ...contract, agents: true, agentProjection: 1, agentContract: 1 }]) {
    const { adapter, calls } = await fixture(t, description)
    assert.notEqual(adapter.capabilities().agents, true)
    for (const name of ['add-agent', 'agent-session', 'agent-adopt', 'remove-agent', 'agent-rename', 'agent-archive']) {
      assert.equal(adapter.capabilities().actions.includes(name), false)
      await assert.rejects(adapter.action(name, {}, signal()), { code: 'ACTION_NOT_ALLOWED' })
    }
    const state = await adapter.state(signal())
    const list = await adapter.conversations(signal())
    assert.deepEqual(state.agents, [])
    assert.equal(list.conversations.some(item => item.kind === 'agent'), false)
    for (const privateValue of [agent.id, agent.name, agent.sessions[0], 'Private session title']) {
      assert.equal(JSON.stringify({ state, list }).includes(privateValue), false)
    }
    assert.ok(calls.every(call => ['state', 'bridge.describe', 'bridge.redact'].includes(call.endpoint)))
  }
})

test('Agent identifiers cannot reach target, submit, history or stream through the Bot contract', async t => {
  const { adapter, calls, sessionReads } = await fixture(t)
  for (const id of [agent.id, agent.sessions[0], route, 'agent:other-team:synthetic-session']) {
    await assert.rejects(adapter.target(id, signal()), { code: 'CONVERSATION_NOT_FOUND' })
    await assert.rejects(adapter.submit({ conversationId: id, sessionId: agent.sessions[0], requestId: 'synthetic-request', text: 'hello' }, signal()), { code: 'CONVERSATION_NOT_FOUND' })
    await assert.rejects(adapter.history(id, {}, signal()), { code: 'CONVERSATION_NOT_FOUND' })
    const stream = adapter.follow(id, {}, signal())
    await assert.rejects(stream.next(), { code: 'CONVERSATION_NOT_FOUND' })
  }
  assert.equal(calls.some(call => call.endpoint === 'bridge.submit'), false)
  assert.deepEqual(sessionReads, [])
})

test('Agent Sessions cannot be injected into Bot or Room submit and history cursors', async t => {
  const { adapter, sessionReads } = await fixture(t)
  for (const conversationId of ['chief', 'room']) {
    await assert.rejects(adapter.submit({ conversationId, sessionId: agent.sessions[0], requestId: 'synthetic-injection', text: 'hello' }, signal()), { code: 'TARGET_CHANGED' })
    const cursor = Buffer.from(JSON.stringify({ v: 1, conversationId, sessionId: agent.sessions[0] })).toString('base64url')
    await assert.rejects(adapter.history(conversationId, { cursor }, signal()), { code: 'SESSION_DENIED' })
  }
  assert.deepEqual(sessionReads, [])
})

test('Agent requests with workspace, adoption, permission or attachment fields remain closed', async t => {
  const { adapter, calls } = await fixture(t)
  for (const payload of [{ workspaceId: 'foreign-workspace' }, { sessionId: 'foreign-session' }, { permissions: ['all'] }, { attachments: ['foreign-file'] }, { unknown: true }]) {
    await assert.rejects(adapter.action('add-agent', payload, signal()), { code: 'ACTION_NOT_ALLOWED' })
    await assert.rejects(adapter.action('agent-session', { agentId: agent.id, ...payload }, signal()), { code: 'ACTION_NOT_ALLOWED' })
  }
  assert.equal(calls.some(call => call.endpoint.startsWith('agent-') || call.endpoint === 'add-agent'), false)
})

test('DS Bot known-value redaction is not a global Agent secret projection', () => {
  const botSecret = 'synthetic-team-value-1001'
  const providerSecret = 'synthetic-provider-value-2002'
  const connectorSecret = 'synthetic-connector-value-3003'
  const redact = redactor([{ name: 'SYNTHETIC_TEAM', value: botSecret }])
  const projected = redact(detail(`An assistant could echo ${botSecret}, ${providerSecret}, ${connectorSecret}.`, Number.MAX_SAFE_INTEGER).text)
  assert.equal(projected.includes(botSecret), false)
  assert.ok(projected.includes('[secret:SYNTHETIC_TEAM]'))
  // This is an intentional counterexample, not an acceptable mobile transcript.
  // It shows only that the redactor removes values it is given. That the host
  // store excludes provider/connector credentials rests on the cited source.
  // If the host adds a real global guarantee, replace this characterization and
  // review the negotiated contract before allowing any Agent output.
  assert.equal(projected.includes(providerSecret), true)
  assert.equal(projected.includes(connectorSecret), true)
})
