import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMobileServer } from '../src/server.js'
import { createRemoteConnection } from '../src/remote-connection.mjs'
import { createRelaySettings } from '../src/relay-settings.mjs'
import { createDeviceController } from '../../ui/src/controller.mjs'
import { canPair } from '../../ui/src/remote-model.mjs'

const relayOrigin = 'wss://relay.example'
const adapter = () => ({ capabilities: () => ({}), dispose: async () => {} })

async function fixture(t, publicUrl = 'https://direct.example') {
  const home = await mkdtemp(join(tmpdir(), 'bridge-pairing-fallback-'))
  const server = await createMobileServer({ home, adapter: adapter(), config: publicUrl ? { publicUrl } : {}, managedRemote: true })
  const remote = await createRemoteConnection({ home, server })
  let report
  const relay = await createRelaySettings({ home, server, defaultRelay: relayOrigin, connect({ onStatus }) {
    report = onStatus
    onStatus({ state: 'offline', computerId: null, computerKey: null })
    return { close() {} }
  } })
  const call = async (method, payload = {}) => {
    if (method === 'status') return { ...await server.operator('status'), remote: remote.snapshot(), relay: relay.snapshot(), pairing: relay.pairingStatus() }
    if (method === 'pairing.create') return relay.pairing() ?? server.operator(method, payload)
    throw Error(`Unexpected operation ${method}`)
  }
  const controller = createDeviceController({ call })
  t.after(async () => { controller.dispose(); await relay.dispose(); await remote.dispose(); await server.close(); await rm(home, { recursive: true, force: true }) })
  return { server, remote, relay, call, controller, report: value => report(value) }
}

test('an unchosen offline default with HTTPS produces a direct QR through the real controller', async t => {
  const f = await fixture(t)
  await f.controller.refresh()
  assert.deepEqual(f.controller.snapshot().status.pairing, { mode: 'direct', available: true })
  assert.equal(canPair(f.controller.snapshot().status), true)
  await f.controller.create()
  const qr = f.controller.snapshot().pairing
  assert.equal(qr.url, 'https://direct.example')
  assert.equal(qr.serverId, f.server.serverId)
  assert.equal(f.controller.snapshot().error, '')
})

test('relay recovery clears the fallback QR and invalidates its code before showing a relay QR', async t => {
  const f = await fixture(t)
  await f.controller.refresh(); await f.controller.create()
  const direct = f.controller.snapshot().pairing
  await f.controller.copy({ writeText: async () => {} })
  f.report({ state: 'connecting', computerId: null, computerKey: null })
  await f.controller.refresh()
  assert.deepEqual(f.controller.snapshot().pairing, direct, 'background relay retries do not clear a usable direct QR')
  assert.equal(f.controller.snapshot().copied, true)
  f.report({ state: 'ready', computerId: 'A'.repeat(22), computerKey: 'B'.repeat(43) })
  await f.controller.refresh()
  assert.deepEqual(f.controller.snapshot().status.pairing, { mode: 'relay', available: true })
  assert.equal(f.controller.snapshot().pairing, null)
  assert.equal(f.controller.snapshot().copied, false)
  const rejected = await fetch(`http://127.0.0.1:${f.server.address.port}/mobile/v1/pairings`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: direct.code, deviceName: 'Late test phone' }),
  })
  assert.equal((await rejected.json()).error.code, 'INVALID_PAIRING_CODE')
  await f.controller.create()
  assert.equal(f.controller.snapshot().pairing.v, 2)
  assert.equal(f.controller.snapshot().pairing.relay, relayOrigin)
  f.report({ state: 'offline', computerId: null, computerKey: null })
  await f.controller.refresh()
  assert.equal(f.controller.snapshot().pairing, null)
  assert.deepEqual(f.controller.snapshot().status.pairing, { mode: 'direct', available: true })
})

test('an explicitly selected offline relay never falls back to an available direct address', async t => {
  const f = await fixture(t)
  await f.relay.select({ mode: 'relay' })
  await f.controller.refresh()
  assert.deepEqual(f.controller.snapshot().status.pairing, { mode: 'relay', available: false })
  assert.equal(canPair(f.controller.snapshot().status), false)
  assert.throws(() => f.relay.pairing(), { code: 'RELAY_NOT_READY' })
  await f.controller.create()
  assert.equal(f.controller.snapshot().pairing, null)
})

test('an offline default without a direct address reports pairing unavailable', async t => {
  const f = await fixture(t, null)
  await f.controller.refresh()
  assert.deepEqual(f.controller.snapshot().status.pairing, { mode: 'relay', available: false })
  assert.equal(canPair(f.controller.snapshot().status), false)
  assert.throws(() => f.relay.pairing(), { code: 'RELAY_NOT_READY' })
})
