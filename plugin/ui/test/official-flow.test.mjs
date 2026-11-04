import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeviceController } from '../src/controller.mjs'
import { createOperatorClient } from '../src/operator-client.mjs'

const official = { enabled: true, serverId: 'computer', url: null, devices: [], pending: [], relay: { mode: 'relay', official: true, relay: 'wss://official.example', computerId: 'A'.repeat(22), state: 'ready', ready: true, revision: 1 }, pairing: { mode: 'relay', available: true } }
const qr = leaseId => ({ v: 2, relay: official.relay.relay, computerId: official.relay.computerId, computerKey: 'B'.repeat(43), serverId: 'computer', code: 'example-code', expiresAt: 2000, leaseId })
const defer = () => { let resolve; return { promise: new Promise(done => { resolve = done }), get resolve() { return resolve } } }

test('official selection needs no form and generates only after ready, once per open', async () => {
  let current = { enabled: false, reason: 'OFFICIAL_AVAILABLE' }, number = 0
  const calls = []
  const c = createDeviceController({ now: () => 10, uuid: () => `lease-${++number}`, call: async (method, payload) => {
    calls.push([method, payload])
    if (method === 'relay.official') current = { ...official, relay: { ...official.relay, state: 'connecting', ready: false }, pairing: { mode: 'relay', available: false } }
    return method === 'status' ? current : method === 'pairing.create' ? qr(payload.leaseId) : {}
  } })
  await c.refresh(); await c.useOfficial(); await c.autoPair()
  assert.equal(calls.filter(([method]) => method === 'pairing.create').length, 0)
  assert.deepEqual(calls.find(([method]) => method === 'relay.official'), ['relay.official', {}])
  current = official; await c.refresh(); await c.autoPair(); await c.autoPair()
  const create = calls.filter(([method]) => method === 'pairing.create')
  assert.equal(create.length, 1)
  assert.equal(create[0][1].automatic, true)
  assert.equal(c.snapshot().pairing.leaseId, undefined, 'owner lease ID must stay out of mobile QR')
  assert.equal(c.snapshot().pairing.relay, official.relay.relay)
  c.clearPairing(); await c.autoPair()
  assert.equal(calls.filter(([method]) => method === 'pairing.create').length, 1, 'hiding the QR disables automatic recreation')
  c.dispose()
})

test('closing an in-flight create cancels its prechosen lease and late response stays hidden', async () => {
  const pending = defer(), calls = []
  const c = createDeviceController({ now: () => 10, uuid: () => 'lease-inflight', call: async (method, payload) => {
    calls.push([method, payload])
    return method === 'pairing.create' ? pending.promise : method === 'status' ? official : {}
  } })
  await c.refresh(); const run = c.create(); c.clearPairing()
  assert.ok(calls.some(([method, payload]) => method === 'pairing.cancel' && payload.leaseId === 'lease-inflight'))
  pending.resolve(qr('lease-inflight')); await run
  assert.equal(c.snapshot().pairing, null)
  c.dispose()
})

test('regeneration and tunnel selection cancel only the active owner lease', async () => {
  let number = 0
  const calls = []
  const c = createDeviceController({ now: () => 10, uuid: () => `lease-${++number}`, call: async (method, payload) => {
    calls.push([method, payload]); return method === 'status' ? official : method === 'pairing.create' ? qr(payload.leaseId) : {}
  } })
  await c.refresh(); await c.create(); await c.create(); await c.selectMode('direct')
  assert.deepEqual(calls.filter(([method]) => method === 'pairing.cancel'), [['pairing.cancel', { leaseId: 'lease-1' }], ['pairing.cancel', { leaseId: 'lease-2' }]])
  assert.equal(c.snapshot().pairing, null)
  c.dispose()
})

test('expiry does not silently generate another auto-approved code', async () => {
  let time = 10
  const calls = []
  const c = createDeviceController({ now: () => time, uuid: () => 'lease-expire', call: async (method, payload) => { calls.push(method); return method === 'status' ? official : method === 'pairing.create' ? qr(payload.leaseId) : {} } })
  await c.refresh(); await c.autoPair(); time = 2001; c.tick(); await c.autoPair()
  assert.equal(c.snapshot().pairing, null)
  assert.equal(calls.filter(method => method === 'pairing.create').length, 1)
  c.dispose()
})

test('owner carrier supports official start and scoped cancellation on the same origin', async () => {
  const calls = []
  const client = createOperatorClient({ root: 'https://desktop.example/', location: undefined, uuid: () => 'rpc', fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, json: async () => ({ type: 'server-response', rpcId: 'rpc', result: { ok: true, value: {} } }) } } })
  await client('relay.official', {}); await client('pairing.cancel', { leaseId: 'owner-lease' })
  assert.ok(calls.every(({ url, init }) => url.startsWith('https://desktop.example/mobile-operator/') && init.credentials === 'same-origin' && init.redirect === 'error'))
  assert.equal(calls[1].init.keepalive, true, 'pagehide cancellation must survive navigation teardown')
  assert.equal(calls[0].init.keepalive, undefined)
})

test('a claimed code stays cancellable until the phone finishes, then reports paired', async () => {
  let current = official
  const calls = []
  const c = createDeviceController({ now: () => 10, uuid: () => 'lease-claim', call: async (method, payload) => { calls.push([method, payload]); return method === 'status' ? current : method === 'pairing.create' ? qr(payload.leaseId) : {} } })
  await c.refresh(); await c.autoPair()
  current = { ...official, pairingLease: { leaseId: 'lease-claim', state: 'claimed', expiresAt: 2000 } }
  await c.refresh()
  assert.equal(c.snapshot().pairing, null)
  assert.equal(c.snapshot().pairingResult, 'claimed')
  c.clearPairing()
  assert.ok(calls.some(([method, payload]) => method === 'pairing.cancel' && payload.leaseId === 'lease-claim'))
  c.dispose()
})

test('completed pairing shows success without granting another QR or cancelling the device', async () => {
  let current = official
  const calls = []
  const c = createDeviceController({ now: () => 10, uuid: () => 'lease-complete', call: async (method, payload) => { calls.push([method, payload]); return method === 'status' ? current : method === 'pairing.create' ? qr(payload.leaseId) : {} } })
  await c.refresh(); await c.autoPair()
  current = { ...official, pairingLease: { leaseId: 'lease-complete', state: 'paired', expiresAt: 2000 } }
  await c.refresh(); await c.autoPair(); c.clearPairing()
  assert.equal(c.snapshot().pairing, null)
  assert.equal(c.snapshot().pairingResult, 'paired')
  assert.equal(calls.filter(([method]) => method === 'pairing.create').length, 1)
  assert.equal(calls.filter(([method]) => method === 'pairing.cancel').length, 0)
  c.dispose()
})

const waiting = { ...official, relay: { ...official.relay, state: 'pending', ready: false } }

test('waiting official QR preserves its approval marker and build tag in displayed and copied data', async () => {
  const c = createDeviceController({ now: () => 10, uuid: () => 'lease-waiting', call: async (method, payload) =>
    method === 'status' ? waiting : method === 'pairing.create' ? { ...qr(payload.leaseId), pending: true, build: 'K'.repeat(43) } : {} })
  await c.refresh(); await c.autoPair()
  assert.equal(c.snapshot().pairing.pending, true)
  let copied
  await c.copy({ writeText: async value => { copied = JSON.parse(value) } })
  assert.equal(copied.pending, true)
  assert.equal(copied.build, 'K'.repeat(43))
  assert.equal(copied.leaseId, undefined, 'the owner cancellation lease stays out of the QR')
  c.dispose()
})

test('approving the same waiting computer preserves its QR until the phone claims and completes it', async () => {
  let current = waiting
  const calls = []
  const c = createDeviceController({ now: () => 10, uuid: () => 'lease-approval', call: async (method, payload) => {
    calls.push(method)
    return method === 'status' ? current : method === 'pairing.create' ? { ...qr(payload.leaseId), pending: true } : {}
  } })
  await c.refresh(); await c.autoPair(); await c.copy({ writeText: async () => {} })
  const issued = c.snapshot().pairing
  current = { ...official, relay: { ...official.relay, revision: waiting.relay.revision + 1 } }
  await c.refresh()
  assert.equal(c.snapshot().pairing, issued, 'approval is not a change of transport or computer identity')
  assert.equal(c.snapshot().copied, true)
  assert.equal(calls.includes('pairing.cancel'), false)
  current = { ...current, pairingLease: { leaseId: 'lease-approval', state: 'claimed', expiresAt: 2000 } }
  await c.refresh()
  assert.equal(c.snapshot().pairing, null)
  assert.equal(c.snapshot().pairingResult, 'claimed')
  assert.equal(calls.includes('pairing.cancel'), false)
  current = { ...current, pairingLease: { ...current.pairingLease, state: 'paired' } }
  await c.refresh(); c.clearPairing()
  assert.equal(c.snapshot().pairingResult, 'paired')
  assert.equal(calls.includes('pairing.cancel'), false)
  c.dispose()
})

test('approval during an in-flight QR request does not discard its response', async () => {
  let current = waiting
  const pending = defer(), calls = []
  const c = createDeviceController({ now: () => 10, uuid: () => 'lease-approval-flight', call: async method => {
    calls.push(method)
    return method === 'status' ? current : method === 'pairing.create' ? pending.promise : {}
  } })
  await c.refresh()
  const run = c.create()
  current = { ...official, relay: { ...official.relay, revision: waiting.relay.revision + 1 } }
  await c.refresh()
  pending.resolve({ ...qr('lease-approval-flight'), pending: true }); await run
  assert.ok(c.snapshot().pairing)
  assert.equal(calls.includes('pairing.cancel'), false)
  c.dispose()
})

test('approval cannot preserve a QR across identity, transport, availability or intervening generation changes', async () => {
  const approved = { ...official, relay: { ...official.relay, revision: waiting.relay.revision + 1 } }
  for (const next of [
    { ...approved, serverId: 'different-computer' },
    { ...approved, relay: { ...approved.relay, computerId: 'C'.repeat(22) } },
    { ...approved, relay: { ...approved.relay, relay: 'wss://different.example' } },
    { ...approved, pairing: { mode: 'direct', available: true } },
    { ...approved, pairing: { mode: 'relay', available: false } },
    { ...approved, remote: { mode: 'fixed', state: 'configured', revision: 3 } },
    { ...approved, relay: { ...approved.relay, revision: waiting.relay.revision + 3 } },
    { ...waiting, relay: { ...waiting.relay, revision: waiting.relay.revision + 1 } },
  ]) {
    let current = waiting
    const calls = []
    const c = createDeviceController({ now: () => 10, uuid: () => 'lease-changed', call: async (method, payload) => {
      calls.push(method)
      return method === 'status' ? current : method === 'pairing.create' ? { ...qr(payload.leaseId), pending: true } : {}
    } })
    await c.refresh(); await c.autoPair()
    current = next; await c.refresh()
    assert.equal(c.snapshot().pairing, null)
    assert.equal(calls.filter(method => method === 'pairing.cancel').length, 1)
    c.dispose()
  }
})
