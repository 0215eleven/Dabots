import test from 'node:test'
import assert from 'node:assert/strict'
import '../../engine/test/harness-resolve.mjs'
import { install as installApprovals } from '../../engine/src/host/approvals.js'
import { createMobileBridge } from '../../engine/src/host/mobile-bridge.js'
import { createAdapter } from '../src/adapter.mjs'
const { redactor } = await import('../../engine/src/host/secrets.js')

const SECRET = 'fixture-private-path-sentinel'
const tick = () => new Promise(resolve => setImmediate(resolve))
const signal = () => AbortSignal.timeout(3000)
async function fixture(t) {
  const listeners = [], controllers = [], calls = []
  let grant = { approvals: true, agents: true }, intercept
  const rt = {
    state: { bots: { chief: { id: 'chief', name: 'Chief', sessionId: 'chat', parts: [] } }, rooms: { room: { id: 'room', name: 'Room', members: ['chief'], parts: ['member'] } }, agents: { coder: { id: 'coder', name: 'Coder', sessions: ['agent-session'] } } },
    groupOwners: new Map([['member', { botId: 'chief', roomId: 'room' }]]), chatOwners: new Map([['chat', 'chief']]),
    chatOf: () => rt.state.bots.chief.sessionId, loadSecrets: async () => {},
    redactSecrets: redactor([{ name: 'FIXTURE', value: SECRET }]),
    ctx: { on: (_name, listener, options) => { if (options?.prepend) listeners.unshift(listener); else listeners.push(listener); return () => { const at = listeners.indexOf(listener); if (at >= 0) listeners.splice(at, 1) } }, sessionController: {} },
  }
  installApprovals(rt)
  const ok = value => ({ ok: true, value }), fail = (_message, code) => ({ ok: false, error: { code } })
  const host = createMobileBridge(rt, { ok, fail })
  const snapshot = () => ({ revision: 1, bots: Object.values(rt.state.bots), rooms: Object.values(rt.state.rooms), agents: Object.values(rt.state.agents), work: { approvals: rt.approvalsView() } })
  const adapter = createAdapter({
    connection: { createSharedFetchHandler: () => ({ fetch: async request => {
      const { endpoint, payload } = await request.json()
      calls.push({ endpoint, payload })
      if (endpoint === 'state') return Response.json(ok(snapshot()))
      if (endpoint === 'approval-answer') { rt.answerApproval(payload.id, payload.choice); return Response.json(ok(true)) }
      const override = await intercept?.(endpoint, payload)
      if (override) return Response.json(override)
      try { return Response.json(await host(endpoint, payload, request.signal)) }
      catch { return Response.json(fail('unavailable', 'bot/redaction-unavailable')) }
    } }) },
    approvalHook: { on: rt.ctx.on, available: place => grant.approvals && (!place.agent || grant.agents) },
  })
  await adapter.initialize()
  t.after(async () => { controllers.forEach(controller => controller.abort()); await adapter.dispose() })
  const ask = (sessionId, reason, toolName = 'bash') => {
    const controller = new AbortController(); controllers.push(controller)
    const request = { agent: { session: { id: sessionId } }, toolName, reason, displayReason: reason, signal: controller.signal }
    const chain = [...listeners], next = () => (chain.shift() ?? (() => Promise.resolve('unavailable')))(request, next)
    return { request, result: Promise.resolve(next()), controller }
  }
  const ready = async () => { for (let i = 0; i < 8; i++) await tick() }
  return { adapter, rt, host, ask, ready, calls, access: () => grant, setGrant: value => { grant = value; adapter.approvalAuthorizationChanged() }, intercept: value => { intercept = value } }
}

for (const [kind, sessionId, id] of [['Bot', 'chat', 'chief'], ['Agent', 'agent-session', 'agent:coder:agent-session'], ['group member', 'member', 'room']]) {
  test(`${kind} approval text crosses the real host known-value redactor before truncation`, async t => {
    const f = await fixture(t)
    const reason = `https://fixture.invalid/plain/${SECRET}/file`, tool = `tool-${SECRET}`
    const asked = f.ask(sessionId, reason, tool)
    await f.ready()
    const [entry] = await f.adapter.approvals(id, signal(), f.access)
    assert.ok(entry.reason.startsWith('https://fixture.invalid/plain/[secret:'))
    assert.ok(entry.tool.startsWith('tool-[secret:'))
    assert.equal(JSON.stringify(entry).includes(SECRET), false)
    assert.equal(asked.request.reason, reason, 'the original host request is never rewritten')
    assert.equal(asked.request.displayReason, reason)
    await f.adapter.answerApproval(entry.id, 'reject', signal(), f.access)
    assert.equal(await asked.result, 'rejected')
  })
  test(`${kind} secrets crossing the 80/500 character boundaries never leak partial prefixes`, async t => {
    const f = await fixture(t), reason = 'r'.repeat(490) + SECRET + '/end', tool = 't'.repeat(75) + SECRET
    const asked = f.ask(sessionId, reason, tool)
    await f.ready()
    const [entry] = await f.adapter.approvals(id, signal(), f.access)
    assert.equal(entry.reason.slice(0, 490), 'r'.repeat(490))
    assert.ok(entry.reason.slice(490).startsWith('[secret:'))
    assert.equal(entry.tool.slice(0, 75), 't'.repeat(75))
    assert.ok(entry.tool.slice(75).startsWith('[secr'))
    assert.ok(entry.reason.length <= 500 && entry.tool.length <= 80)
    assert.equal(JSON.stringify(entry).includes('fixture-pr'), false)
    if (kind === 'group member') assert.equal(f.rt.approvalsView()[0].reason.length, 500, 'the desktop projection stays unchanged')
    asked.controller.abort(); assert.equal(await asked.result, 'cancelled')
  })
}

test('unavailable or malformed host redaction fails closed without returning original approval text', async t => {
  for (const group of [false, true]) {
    const f = await fixture(t), asked = f.ask(group ? 'member' : 'chat', SECRET)
    await f.ready()
    for (const mode of ['throw', 'malformed', 'unsupported']) {
      f.intercept((endpoint, payload) => {
        if (endpoint !== 'bridge.approval-text' && !(endpoint === 'bridge.redact' && payload.texts.includes(SECRET))) return
        if (mode === 'throw') throw Error('private failure ' + SECRET)
        return mode === 'unsupported' ? { ok: false, error: { code: 'bot/not-found' } } : { ok: true, value: { texts: [], approvals: [] } }
      })
      await assert.rejects(f.adapter.approvals(group ? 'room' : 'chief', signal(), f.access), problem => {
        assert.equal(JSON.stringify({ message: problem.message, code: problem.code }).includes(SECRET), false)
        return true
      })
    }
    asked.controller.abort(); assert.equal(await asked.result, 'cancelled')
  }
})

test('grant loss, session movement and group membership changes during host redaction release no text', async t => {
  for (const change of ['approvals', 'agents', 'session', 'members']) {
    const f = await fixture(t), group = change === 'members', agent = change === 'agents'
    const asked = f.ask(group ? 'member' : agent ? 'agent-session' : 'chat', SECRET)
    await f.ready()
    let release, entered
    const gate = new Promise(resolve => { entered = resolve })
    f.intercept(async (endpoint, payload) => {
      if (endpoint === 'bridge.approval-text' || endpoint === 'bridge.redact' && payload.texts.includes(SECRET)) {
        entered(); await new Promise(resolve => { release = resolve })
      }
    })
    const listed = f.adapter.approvals(group ? 'room' : agent ? 'agent:coder:agent-session' : 'chief', signal(), f.access)
    const rejected = assert.rejects(listed)
    await gate
    if (change === 'approvals') f.setGrant({ approvals: false, agents: true })
    if (change === 'agents') f.setGrant({ approvals: true, agents: false })
    if (change === 'session') f.rt.state.bots.chief.sessionId = 'new-chat'
    if (change === 'members') f.rt.state.rooms.room.members = []
    release(); await rejected
    asked.controller.abort(); await asked.result
  }
})

test('group text projection validates membership, approval ownership and completion independently at the host', async t => {
  const f = await fixture(t), asked = f.ask('member', SECRET)
  await f.ready()
  const [{ id }] = f.rt.approvalsView()
  const payload = { conversationId: 'room', expectedSessionId: 'room', expectedMembers: ['chief'], ids: [id] }
  assert.equal((await f.host('bridge.approval-text', payload, signal())).value.approvals[0].reason, '[secret:FIXTURE]')
  for (const changed of [{ expectedMembers: [] }, { expectedSessionId: 'member' }, { ids: ['missing'] }, { conversationId: 'chief' }]) {
    const result = await f.host('bridge.approval-text', { ...payload, ...changed }, signal()).catch(() => ({ ok: false }))
    assert.equal(result.ok, false)
    assert.equal(JSON.stringify(result).includes(SECRET), false)
  }
  asked.controller.abort(); await asked.result
  await assert.rejects(f.host('bridge.approval-text', payload, signal()), { code: 'bot/stale' })
})

test('an old host without full group approval redaction never exposes its truncated owner-only reason', async t => {
  const f = await fixture(t)
  f.intercept(endpoint => endpoint === 'bridge.describe' ? { ok: true, value: { version: 1, redactedText: true, stableRequestId: true, groups: true, groupProjection: 1, agents: 1 } } : undefined)
  await f.adapter.initialize()
  const asked = f.ask('member', 'r'.repeat(490) + SECRET)
  await f.ready()
  await assert.rejects(f.adapter.approvals('room', signal(), f.access), { code: 'REDACTION_UNAVAILABLE' })
  asked.controller.abort(); await asked.result
})
