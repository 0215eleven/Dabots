import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeviceController } from '../src/controller.mjs'
import { createOperatorClient } from '../src/operator-client.mjs'
import { canPair } from '../src/remote-model.mjs'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const status = (patch = {}) => ({ enabled: true, url: 'https://one.trycloudflare.com', serverId: 'computer', pending: [], devices: [], remote: { mode: 'quick', state: 'running', url: 'https://one.trycloudflare.com', configuredUrl: '', loopbackUrl: 'http://127.0.0.1:8080', revision: 1, quickAvailable: true, error: null }, ...patch })
const pairing = () => ({ url: 'https://one.trycloudflare.com', code: 'test-only-code', serverId: 'computer', expiresAt: 1000 })

test('refresh clears copied pairing on address change, stop or revision change', async () => {
  for (const next of [status({ url: 'https://two.trycloudflare.com', remote: { ...status().remote, url: 'https://two.trycloudflare.com', revision: 2 } }), status({ url: null, remote: { ...status().remote, url: null, state: 'stopped', revision: 2 } }), status({ remote: { ...status().remote, revision: 2 } })]) {
    let current = status()
    const controller = createDeviceController({ now: () => 10, call: async method => method === 'pairing.create' ? pairing() : current })
    await controller.refresh(); await controller.create(); await controller.copy({ writeText: async () => {} })
    assert.equal(controller.snapshot().copied, true)
    current = next; await controller.refresh()
    assert.equal(controller.snapshot().pairing, null)
    assert.equal(controller.snapshot().copied, false)
    controller.dispose()
  }
})

test('a stale pairing response cannot restore credentials after a remote status transition', async () => {
  const pending = deferred(); let current = status()
  const controller = createDeviceController({ now: () => 10, call: method => method === 'pairing.create' ? pending.promise : Promise.resolve(current) })
  await controller.refresh(); const creating = controller.create()
  current = status({ url: null, remote: { ...status().remote, state: 'error', url: null, revision: 2 } })
  await controller.refresh(); pending.resolve(pairing()); await creating
  assert.equal(controller.snapshot().pairing, null)
  assert.equal(controller.snapshot().busy, false)
})

test('choosing quick mode saves only the mode and never starts a tunnel', async () => {
  const calls = []
  const controller = createDeviceController({ call: async (method, payload) => { calls.push([method, payload]); return status() } })
  assert.equal(typeof controller.configureRemote, 'function')
  await controller.configureRemote('quick')
  assert.deepEqual(calls, [['remote.configure', { mode: 'quick' }], ['status', {}]])
})

test('quick start requires confirmation and repeated starts share the operation', async () => {
  const started = deferred(), calls = []
  const controller = createDeviceController({ call: (method, payload) => { calls.push([method, payload]); return method === 'remote.start' ? started.promise : Promise.resolve(status()) } })
  assert.equal(typeof controller.startRemote, 'function')
  await controller.startRemote(false)
  assert.equal(calls.length, 0)
  const first = controller.startRemote(true), second = controller.startRemote(true)
  assert.deepEqual(calls, [['remote.start', { confirmed: true }]])
  started.resolve({}); await Promise.all([first, second])
  assert.equal(controller.snapshot().busy, false)
})

test('stop remains actionable during startup and late start responses do not restore pairing', async () => {
  const started = deferred(), calls = []
  const controller = createDeviceController({ call: (method, payload) => { calls.push([method, payload]); return method === 'remote.start' ? started.promise : Promise.resolve(status({ url: null, remote: { ...status().remote, state: 'stopped', url: null } })) } })
  assert.equal(typeof controller.stopRemote, 'function')
  const starting = controller.startRemote(true)
  await controller.stopRemote()
  assert.equal(calls.filter(([method]) => method === 'remote.stop').length, 1)
  started.resolve({ url: 'https://late.trycloudflare.com' }); await starting
  assert.equal(controller.snapshot().status.url, null)
  assert.equal(controller.snapshot().busy, false)
})

test('HTTPS entry validation refuses credentials and non-origin URL before sending it', async () => {
  const calls = []
  const controller = createDeviceController({ call: async (method, payload) => { calls.push([method, payload]); return status() } })
  assert.equal(typeof controller.configureRemote, 'function')
  for (const url of ['', 'http://phone.example', 'https://u:p@phone.example', 'https://phone.example/path', 'https://phone.example/.', 'https://phone.example/%2e', 'https://@phone.example', 'https://phone.example?token=private', 'https://phone.example#fragment', 'https://phone.example\\evil', 'https://phone.example\n']) {
    await controller.configureRemote('fixed', url)
    assert.equal(calls.length, 0)
    assert.ok(controller.snapshot().error)
  }
  await controller.configureRemote('fixed', 'https://phone.example/')
  assert.deepEqual(calls[0], ['remote.configure', { mode: 'fixed', url: 'https://phone.example' }])
})

test('changing transport clears a QR immediately and disposal aborts its request', async () => {
  const pending = deferred(); let signal
  const controller = createDeviceController({ now: () => 10, call: (method, _payload, passedSignal) => {
    if (method === 'pairing.create') return Promise.resolve(pairing())
    if (method === 'remote.configure') { signal = passedSignal; return pending.promise }
    return Promise.resolve(status())
  } })
  await controller.refresh(); await controller.create()
  assert.equal(typeof controller.configureRemote, 'function')
  const configuring = controller.configureRemote('existing', 'https://phone.example')
  assert.equal(controller.snapshot().pairing, null)
  controller.dispose(); assert.equal(signal.aborted, true)
  pending.resolve({}); await configuring
  assert.equal(controller.snapshot().status, null)
})

test('operator client allows remote commands only through same-origin owner carrier', async () => {
  const sent = []
  const call = createOperatorClient({ root: 'https://desktop.example/', location: undefined, uuid: () => 'rpc', fetchImpl: async (url, init) => { sent.push({ url: String(url), init }); return { ok: true, json: async () => ({ type: 'server-response', rpcId: 'rpc', result: { ok: true, value: {} } }) } } })
  for (const method of ['remote.configure', 'remote.start', 'remote.stop']) await call(method, {})
  assert.equal(sent.length, 3)
  assert.ok(sent.every(item => item.url.startsWith('https://desktop.example/mobile-operator/remote.') && item.init.credentials === 'same-origin' && item.init.redirect === 'error'))
})

test('operator errors present Chinese owner/setup guidance without server error text', async () => {
  const owner = createOperatorClient({ root: 'https://desktop.example/', location: undefined, fetchImpl: async () => ({ ok: false, status: 403 }) })
  await assert.rejects(owner('status'), error => error.code === 'HTTP_403' && /所有者/.test(error.message))
  const refused = createOperatorClient({ root: 'https://desktop.example/', location: undefined, uuid: () => 'rpc', fetchImpl: async () => ({ ok: true, json: async () => ({ type: 'server-response', rpcId: 'rpc', result: { ok: false, error: { code: 'MISSING_CLOUDFLARED', message: 'private diagnostic' } } }) }) })
  await assert.rejects(refused('remote.start', { confirmed: true }), error => error.code === 'MISSING_CLOUDFLARED' && /cloudflared/.test(error.message) && !error.message.includes('private diagnostic'))
})

const relayStatus = (patch = {}) => status({ relay: { mode: 'relay', relay: 'wss://relay.example', secretSet: true, state: 'ready', computerId: 'A'.repeat(22), ready: true, revision: 1, ...patch } })
const relayPairing = () => ({ v: 2, relay: 'wss://relay.example', computerId: 'A'.repeat(22), computerKey: 'B'.repeat(43), serverId: 'computer', code: 'test-only-code', expiresAt: 1000 })

test('relay mode pairs only when the relay is ready and shows the relay identity, not an address', async () => {
  let current = relayStatus({ state: 'connecting', ready: false })
  const controller = createDeviceController({ now: () => 10, call: async method => method === 'pairing.create' ? relayPairing() : current })
  await controller.refresh()
  assert.equal(canPair(controller.snapshot().status), false)
  current = relayStatus(); await controller.refresh(); await controller.create()
  assert.deepEqual(controller.snapshot().pairing, relayPairing())
  current = relayStatus({ computerId: 'C'.repeat(22), revision: 2 }); await controller.refresh()
  assert.equal(controller.snapshot().pairing, null, 'a new relay identity invalidates the shown code')
  controller.dispose()
})

test('a direct response cannot be shown while status selects the relay transport', async () => {
  const controller = createDeviceController({ now: () => 10, call: async method => method === 'pairing.create' ? pairing() : { ...relayStatus(), pairing: { mode: 'relay', available: true } } })
  await controller.refresh(); await controller.create()
  assert.equal(controller.snapshot().pairing, null)
  controller.dispose()
})

test('a delayed fallback response cannot restore a QR after the default relay recovers', async () => {
  const pending = deferred()
  let current = { ...relayStatus({ state: 'offline', ready: false }), pairing: { mode: 'direct', available: true } }
  const controller = createDeviceController({ now: () => 10, call: async method => method === 'pairing.create' ? pending.promise : current })
  await controller.refresh()
  const creating = controller.create()
  current = { ...relayStatus(), pairing: { mode: 'relay', available: true } }
  await controller.refresh()
  pending.resolve(pairing()); await creating
  assert.equal(controller.snapshot().pairing, null)
  controller.dispose()
})

test('saving the relay keeps the optional secret out of controller state and switches once', async () => {
  const calls = []
  let current = status({ relay: { mode: 'direct', relay: null, secretSet: false, state: 'disabled', computerId: null, ready: false, revision: 0 } })
  const secret = 'x'.repeat(40)
  const controller = createDeviceController({ now: () => 10, call: async (method, payload) => {
    calls.push([method, payload])
    if (method === 'relay.configure') current = status({ relay: { ...current.relay, relay: payload.relay, secretSet: true, revision: 1 } })
    if (method === 'relay.select') current = relayStatus()
    return method === 'status' ? current : {}
  } })
  await controller.refresh()
  // An open relay needs no secret.
  await controller.useRelay('wss://relay.example', '')
  assert.equal(controller.snapshot().error, '')
  await controller.useRelay('wss://relay.example/', secret)
  assert.deepEqual(calls.filter(([method]) => method !== 'status'), [['relay.configure', { relay: 'wss://relay.example' }], ['relay.select', { mode: 'relay' }], ['relay.configure', { relay: 'wss://relay.example', secret }]])
  assert.equal(JSON.stringify(controller.snapshot()).includes(secret), false)
  await controller.useRelay('https://relay.example', secret)
  assert.match(controller.snapshot().error, /wss:\/\//)
  controller.dispose()
})
