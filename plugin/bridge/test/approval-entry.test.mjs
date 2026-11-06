import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startBridge } from '../index.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
test('the real Bridge entry admits only target-qualified devices and withdraws no-window approvals on owner grant changes', async t => {
  const home = await mkdtemp(join(tmpdir(), 'approval-entry-')), listeners = []
  const state = { revision: 1, bots: [{ id: 'chief', name: 'Chief', sessionId: 'chat', parts: [] }], rooms: [], agents: [{ id: 'coder', name: 'Coder', sessions: ['agent-session'] }], work: { approvals: [] } }
  const ctx = {
    on: (_name, listener, options) => { if (options?.prepend) listeners.unshift(listener); else listeners.push(listener); return () => { const at = listeners.indexOf(listener); if (at >= 0) listeners.splice(at, 1) } },
    sessionController: {},
    connection: { createSharedFetchHandler: () => ({ fetch: async request => {
      const { endpoint, payload } = await request.json()
      return Response.json({ ok: true, value: endpoint === 'state' ? state : endpoint === 'bridge.redact' ? { texts: payload.texts } : { version: 1, redactedText: true, stableRequestId: true, agents: 1 } })
    } }) },
  }
  const bridge = await startBridge(ctx, { home, host: '127.0.0.1', port: 0, devAllowInsecure: true, relay: '' })
  t.after(async () => { await bridge.close(); await rm(home, { recursive: true, force: true }) })
  const root = `http://127.0.0.1:${bridge.address.port}/mobile/v1/`
  const post = async (path, body) => (await fetch(root + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
  async function phone(name) {
    const pairing = await bridge.operator('pairing.create')
    const claim = await post('pairings', { code: pairing.code, deviceName: name })
    await bridge.operator('pairing.approve', { requestId: claim.requestId })
    return post('pairings/complete', { claimToken: claim.claimToken })
  }
  function ask(sessionId) {
    const signal = AbortSignal.timeout(3000), request = { agent: { session: { id: sessionId } }, toolName: 'bash', reason: 'synthetic', signal }
    const chain = [...listeners], next = () => (chain.shift() ?? (() => Promise.resolve('unavailable')))(request, next)
    return { result: Promise.resolve(next()), request, signal }
  }
  const one = await phone('Approver'), two = await phone('Agent user')
  await bridge.operator('device.approvals', { id: one.deviceId, enabled: true })
  await bridge.operator('device.agents', { id: two.deviceId, enabled: true })
  const unavailable = ask('agent-session')
  assert.equal(await unavailable.result, 'unavailable')
  assert.equal(unavailable.request.signal, unavailable.signal)
  const bot = ask('chat')
  for (let i = 0; i < 8; i++) await tick()
  const list = await (await fetch(root + 'conversations/chief/approvals', { headers: { authorization: `Bearer ${one.accessToken}` } })).json()
  assert.equal(list.approvals.length, 1, 'Bot approvals need only the approvals grant')
  await bridge.operator('device.approvals', { id: one.deviceId, enabled: false })
  assert.equal(await bot.result, 'unavailable')
  await bridge.operator('device.approvals', { id: one.deviceId, enabled: true })
  await bridge.operator('device.agents', { id: one.deviceId, enabled: true })
  const agent = ask('agent-session')
  for (let i = 0; i < 8; i++) await tick()
  const shown = await (await fetch(root + 'conversations/' + encodeURIComponent('agent:coder:agent-session') + '/approvals', { headers: { authorization: `Bearer ${one.accessToken}` } })).json()
  assert.equal(shown.approvals.length, 1)
  await bridge.operator('device.revoke', { id: one.deviceId })
  assert.equal(await agent.result, 'unavailable')
  assert.equal(bridge.anyApprovals({ agent: true }), false)
})
