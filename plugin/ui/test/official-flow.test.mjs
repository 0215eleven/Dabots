import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeviceController } from '../src/controller.mjs'
import { createOperatorClient } from '../src/operator-client.mjs'

const official = { enabled: true, serverId: 'computer', url: null, devices: [], pending: [], relay: { mode: 'relay', official: true, relay: 'wss://dsbot.ziyuegege.com', computerId: 'A'.repeat(22), state: 'ready', ready: true, revision: 1 }, pairing: { mode: 'relay', available: true } }
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
