import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAuthStore } from '../src/auth.js'
import { createApprovalBroker } from '../src/approval-broker.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
async function fixture(t, { desktop = false, owner } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'approval-authorization-'))
  let broker, listener, card
  const auth = await createAuthStore(home, { onAuthorizationChanged: () => broker?.reconcile() })
  broker = createApprovalBroker({
    on: (_name, handler) => { listener = handler; return () => {} },
    owner: owner ?? (async id => ({ conversationId: id, agent: id === 'agent' })),
    available: place => auth.anyApprovals(place),
  })
  t.after(async () => { broker.dispose(); await auth.close(); await rm(home, { recursive: true, force: true }) })
  const ask = (id = 'agent', controller = new AbortController()) => {
    const request = { agent: { session: { id } }, signal: controller.signal, toolName: 'bash', reason: 'synthetic approval' }
    const original = request.signal
    const result = listener(request, () => desktop ? new Promise(resolve => {
      card = { answer: resolve, closed: false }
      request.signal.addEventListener('abort', () => { card.closed = true; resolve('cancelled') }, { once: true })
    }) : Promise.resolve('unavailable'))
    return { result, request, original, controller }
  }
  const devices = async entries => {
    auth.data.devices = entries.map(entry => ({ id: entry.id, refreshExpiresAt: Date.now() + 30000, ...entry }))
    await auth.save()
  }
  return { auth, broker, ask, devices, get card() { return card } }
}

test('Agent approval requires both grants on the same valid device; offline authorization remains sufficient', async t => {
  const f = await fixture(t)
  await f.devices([{ id: 'approver', approvals: true, agents: false }, { id: 'agent-user', agents: true, approvals: false }])
  assert.equal(f.auth.anyApprovals({ agent: true }), false)
  const denied = f.ask()
  assert.equal(await denied.result, 'unavailable')
  assert.equal(denied.request.signal, denied.original, 'unqualified requests never replace the host signal')
  const bot = f.ask('bot')
  await tick()
  assert.equal(f.broker.list('bot').length, 1)
  bot.controller.abort()
  assert.equal(await bot.result, 'cancelled')
  await f.auth.setAgents('approver', true)
  const admitted = f.ask()
  await tick()
  const [entry] = f.broker.list('agent')
  assert.ok(entry, 'a refresh-authorized device need not have an open network socket')
  assert.equal(f.broker.answer(entry.id, 'reject'), true)
  assert.equal(await admitted.result, 'rejected')
  assert.equal(admitted.request.signal, admitted.original)
})

for (const change of ['approvals', 'agents', 'revoke', 'remove']) test(`removing the last eligible phone by ${change} completes a no-window request without approving it`, async t => {
  const f = await fixture(t)
  await f.devices([{ id: 'one', agents: true, approvals: true }, { id: 'two', agents: true, approvals: true }])
  const asked = f.ask()
  await tick()
  await f.auth.revoke('one')
  const [entry] = f.broker.list('agent')
  assert.ok(entry, 'another fully qualified device still owns the phone path')
  if (change === 'revoke') await f.auth.revoke('two')
  else if (change === 'remove') { f.auth.data.devices = []; await f.auth.save() }
  else await f.auth[change === 'agents' ? 'setAgents' : 'setApprovals']('two', false)
  assert.equal(await asked.result, 'unavailable')
  assert.equal(f.broker.size, 0)
  assert.equal(f.broker.answer(entry.id, 'allow'), false)
  assert.equal(asked.request.signal, asked.original)
})

test('a real authorization expiry deadline withdraws the last phone; access-token expiry alone does not', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const f = await fixture(t)
  await f.devices([{ id: 'one', agents: true, approvals: true, accessExpiresAt: 1001, refreshExpiresAt: 1200 }])
  const asked = f.ask()
  await tick()
  t.mock.timers.tick(100)
  assert.equal(f.broker.size, 1, 'the phone can refresh its short-lived access token')
  t.mock.timers.tick(100)
  assert.equal(await asked.result, 'unavailable')
  assert.equal(f.broker.size, 0)
  assert.equal(f.auth.approvalsAllowed('one'), false)
})

test('withdrawal preserves a pending computer card and its decision, including original cancellation and bridge disposal', async t => {
  const f = await fixture(t, { desktop: true })
  for (const action of ['desktop', 'cancel', 'dispose']) {
    await f.devices([{ id: 'one', agents: true, approvals: true }])
    const asked = f.ask()
    await tick()
    await f.auth.setApprovals('one', false)
    assert.equal(f.broker.size, 0)
    assert.equal(f.card.closed, false, 'withdrawing mobile authority must not close the computer card')
    if (action === 'desktop') f.card.answer('rejected')
    if (action === 'cancel') asked.controller.abort()
    if (action === 'dispose') f.broker.dispose()
    assert.equal(await asked.result, action === 'desktop' ? 'rejected' : 'cancelled')
    assert.equal(asked.request.signal, asked.original)
  }
})

test('authorization is checked after an asynchronous owner lookup, and original abort wins before admission', async t => {
  let release
  const f = await fixture(t, { owner: () => new Promise(resolve => { release = resolve }) })
  await f.devices([{ id: 'one', agents: true, approvals: true }])
  const first = f.ask()
  await f.auth.revoke('one')
  release({ conversationId: 'agent', agent: true })
  assert.equal(await first.result, 'unavailable')
  assert.equal(first.request.signal, first.original)
  const aborted = f.ask()
  aborted.controller.abort()
  release({ conversationId: 'agent', agent: true })
  assert.equal(await aborted.result, 'cancelled')
  assert.equal(f.broker.size, 0)
})
