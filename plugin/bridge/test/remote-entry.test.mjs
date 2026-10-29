import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { startBridge, apply } from '../index.mjs'
import { validateConfig } from '../src/config.mjs'

const connection = {
  createPeer: () => ({ dispose() {} }),
  createSharedFetchHandler: () => ({ async fetch(request) {
    const { endpoint } = await request.json()
    return Response.json({ ok: true, value: endpoint === 'bridge.describe' ? { version: 1, stableRequestId: true, redactedText: true } : { bots: [], rooms: [], mainBotIds: [], models: [] } })
  } }),
}

test('production Bridge entry exposes saved remote selection and awaits transport cleanup', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-entry-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const config = { home, publicUrl: 'https://original.example' }
  const bridge = await startBridge({ connection, sessionController: {} }, config)
  t.after(() => bridge.close())
  assert.equal((await bridge.operator('status')).remote?.mode, 'existing')
  await bridge.operator('remote.configure', { mode: 'fixed', url: 'https://fixed.example' })
  assert.equal(bridge.url, 'https://fixed.example')
  assert.equal(config.publicUrl, 'https://original.example')
  await bridge.close()
  const restarted = await startBridge({ connection, sessionController: {} }, config)
  t.after(() => restarted.close())
  assert.equal(restarted.url, 'https://fixed.example')
  await restarted.operator('remote.configure', { mode: 'quick' })
  assert.equal(restarted.url, null)
  await restarted.close()
  const stopped = await startBridge({ connection, sessionController: {} }, config)
  t.after(() => stopped.close())
  assert.equal((await stopped.operator('status')).remote.state, 'stopped')
  assert.equal(stopped.url, null)
})

test('explicit quick configuration starts only the loopback Bridge and never a tunnel', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-inert-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const bridge = await startBridge({ connection, sessionController: {} }, { home, remoteMode: 'quick' })
  t.after(() => bridge.close())
  const status = await bridge.operator('status')
  assert.equal(status.url, null)
  assert.equal(status.remote.state, 'stopped')
  await assert.rejects(bridge.operator('pairing.create'), { code: 'REMOTE_NOT_READY' })
  assert.throws(() => validateConfig({ remoteMode: 'typo' }))
})

test('a previous unconfirmed tunnel cleanup blocks reload before opening any listener', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-block-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'remote-cleanup-required.json'), JSON.stringify({ version: 1, reason: 'UNCONFIRMED_TUNNEL_STOP' }))
  let connected = false
  await assert.rejects(startBridge({ connection: { createSharedFetchHandler() { connected = true; throw Error('must not initialize') } } }, { home, publicUrl: 'https://fixed.example' }), { code: 'REMOTE_CLEANUP_REQUIRED' })
  assert.equal(connected, false)
})

test('blocked startup reports safe recovery instructions through the owner status route', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-recovery-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'remote-cleanup-required.json'), '{}')
  let handler, cleanup
  const errors = []
  apply({ connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    webServer: { register(route) { handler = route.handler; return () => {} } }, effect(fn) { cleanup = fn() }, emit(_event, error) { errors.push(error) } }, { enabled: true, home })
  t.after(() => cleanup())
  for (let attempt = 0; attempt < 20 && !errors.length; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(typeof handler, 'function')
  assert.ok(errors[0].message.includes('remote-cleanup-required.json'))
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/mobile-operator/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'recovery', method: 'status', payload: {} }),
  })
  const status = (await response.json()).result.value
  assert.equal(status.enabled, false)
  assert.equal(status.reason, 'REMOTE_CLEANUP_REQUIRED')
  assert.ok(status.message.includes('remote-cleanup-required.json'))
})

test('disabled plugin remains inert and rejects remote mutations through owner dispatcher', async t => {
  let handler, cleanup
  apply({ connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) }, webServer: { register(route) { handler = route.handler; return () => {} } }, effect(fn) { cleanup = fn() } }, {})
  await new Promise(resolve => setImmediate(resolve))
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/mobile-operator/remote.start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'disabled', method: 'remote.start', payload: { confirmed: true } }),
  })
  assert.equal((await response.json()).result.error.code, 'CONFIGURATION_REQUIRED')
  await cleanup()
})

test('production owner route returns safe confirmation failures and plugin cleanup removes the listener', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-owner-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  let handler, cleanup, registered
  const ready = new Promise(resolve => { registered = resolve })
  const ctx = { connection: { ...connection, admit: request => request.headers.authorization === 'owner-fixture'
    ? { peer: { principal: { kind: 'owner' } } } : { peer: { principal: { kind: 'device' } } } }, sessionController: {},
    webServer: { register(route) { handler = route.handler; registered(); return () => { handler = null } } }, effect(fn) { cleanup = fn() } }
  apply(ctx, { enabled: true, home, remoteMode: 'quick' })
  t.after(() => cleanup())
  await ready
  const ownerServer = createServer((request, response) => { if (handler) void handler(request, response); else { response.writeHead(404); response.end() } })
  await new Promise(resolve => ownerServer.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => ownerServer.close(resolve)))
  const endpoint = `http://127.0.0.1:${ownerServer.address().port}/mobile-operator/remote.start`
  const body = JSON.stringify({ type: 'client-request', rpcId: 'owner', method: 'remote.start', payload: { confirmed: false } })
  const denied = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  assert.equal(denied.status, 403)
  await denied.text()
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'owner-fixture' }, body })
  assert.equal((await response.json()).result.error.code, 'EXPOSURE_CONFIRMATION_REQUIRED')
  await cleanup()
  assert.equal(handler, null)
})

test('production entry offers the relay mode beside direct access and never returns the relay secret', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-relay-entry-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const bridge = await startBridge({ connection, sessionController: {} }, { home, publicUrl: 'https://direct.example' })
  t.after(() => bridge.close())
  const secret = 'relay-registration-secret-'.padEnd(48, 'x')
  assert.deepEqual((await bridge.operator('status')).relay, { mode: 'direct', relay: null, secretSet: false, state: 'disabled', computerId: null, ready: false, revision: 0 })
  assert.equal((await bridge.operator('pairing.create')).url, 'https://direct.example')
  await assert.rejects(bridge.operator('relay.select', { mode: 'relay' }), { code: 'RELAY_NOT_CONFIGURED' })
  // An unreachable relay: configuration is saved, the door stays closed and pairing says why.
  await bridge.operator('relay.configure', { relay: 'wss://relay.invalid', secret })
  const selected = await bridge.operator('relay.select', { mode: 'relay' })
  assert.equal(selected.mode, 'relay'); assert.equal(selected.ready, false)
  await assert.rejects(bridge.operator('pairing.create'), { code: 'RELAY_NOT_READY' })
  const status = await bridge.operator('status')
  assert.equal(JSON.stringify(status).includes(secret), false)
  assert.equal(status.relay.secretSet, true)
  await bridge.operator('relay.select', { mode: 'direct' })
  assert.equal((await bridge.operator('pairing.create')).url, 'https://direct.example', 'direct pairing is untouched by the relay settings')
})
