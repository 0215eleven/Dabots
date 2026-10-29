import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocket } from 'ws'
import { createMobileServer } from '../src/server.js'
import { registerOwnerOperator } from '../src/operator.mjs'

async function fixture(t, config = {}, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-http-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const adapter = {
    capabilities: () => ({ stream: true }), target: async () => ({ sessionId: 'session' }),
    async *follow(_id, _cursor, signal) { yield { type: 'reset', messages: [] }; await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) },
  }
  const server = await createMobileServer({ home, config, adapter, ...options })
  t.after(() => server.close())
  const root = `http://127.0.0.1:${server.address.port}`
  const request = async (path, body) => {
    const response = await fetch(root + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  return { server, root, request }
}

test('managed loopback listener waits for a public address and invalidates old codes on URL change', async t => {
  const f = await fixture(t, {}, { managedRemote: true })
  assert.equal((await f.server.operator('status')).url, null)
  await assert.rejects(f.server.operator('pairing.create'), { code: 'REMOTE_NOT_READY' })
  assert.equal((await f.request('/mobile/v1/info')).status, 200)
  assert.notEqual((await f.request('/mobile-operator/remote.start', { confirmed: true })).status, 200)
  f.server.setPublicUrl('https://one.example')
  const pairing = await f.server.operator('pairing.create')
  f.server.setPublicUrl('https://two.example')
  const stale = await f.request('/mobile/v1/pairings', { code: pairing.code, deviceName: 'Synthetic phone' })
  assert.equal(stale.status, 400)
  assert.equal(stale.body.error.code, 'INVALID_PAIRING_CODE')
  const fresh = await f.server.operator('pairing.create')
  assert.equal(fresh.url, 'https://two.example')
  f.server.setPublicUrl(null)
  await assert.rejects(f.server.operator('pairing.create'), { code: 'REMOTE_NOT_READY' })
})

test('HTTP pairing requires owner approval and authenticated WebSocket remains available after URL changes', async t => {
  const f = await fixture(t, { publicUrl: 'https://first.example' })
  const pairing = await f.server.operator('pairing.create')
  const started = await f.request('/mobile/v1/pairings', { code: pairing.code, deviceName: 'Synthetic phone' })
  const before = await f.request('/mobile/v1/pairings/complete', { claimToken: started.body.claimToken })
  assert.equal(before.body.status, 'pending')
  await f.server.operator('pairing.approve', { requestId: started.body.requestId })
  const session = (await f.request('/mobile/v1/pairings/complete', { claimToken: started.body.claimToken })).body
  f.server.setPublicUrl('https://second.example')
  assert.equal(f.server.isDeviceAuthorized(session.deviceId), true)
  const socket = new WebSocket(f.root.replace('http:', 'ws:') + '/mobile/v1/events')
  t.after(() => socket.terminate())
  await once(socket, 'open')
  const message = once(socket, 'message')
  socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'test' }))
  assert.equal(JSON.parse((await message)[0]).type, 'ready')
  const refreshed = await f.request('/mobile/v1/auth/refresh', { refreshToken: session.refreshToken })
  assert.equal(refreshed.status, 200)
  assert.equal(refreshed.body.deviceId, session.deviceId)
})

test('managed remote mode never weakens listener binding or accepts invalid replacement URLs', async t => {
  const f = await fixture(t, { publicUrl: 'https://existing.example' })
  for (const url of ['http://example.com', 'https://u:p@example.com', 'https://example.com/path', 'https://example.com?']) {
    assert.throws(() => f.server.setPublicUrl(url))
    assert.equal((await f.server.operator('status')).url, 'https://existing.example')
  }
  await assert.rejects(fixture(t, { host: '0.0.0.0' }, { managedRemote: true }), /loopback/)
  await assert.rejects(fixture(t, {}), /publicUrl/)
})

test('static HTTPS configuration rejects normalization tricks before opening a listener', async t => {
  for (const publicUrl of ['https://host.example?', 'https://host.example#', 'https://@host.example', 'https://host.example/%2e', ' https://host.example', 'https:\\host.example']) {
    await assert.rejects(fixture(t, { publicUrl }), { code: 'INVALID_REMOTE_URL' })
  }
})

test('remote operations pass through the authenticated owner carrier and reject other principals', async t => {
  let dispatches = 0
  let handler
  const ctx = { webServer: { register(route) { handler = route.handler; return () => {} } }, connection: { admit(request) {
    return request.headers.authorization === 'synthetic-owner' ? { peer: { principal: { kind: 'owner' } } }
      : request.headers.authorization === 'synthetic-device' ? { peer: { principal: { kind: 'device' } } } : { rejection: 401 }
  } } }
  registerOwnerOperator(ctx, '/mobile-operator', async () => { dispatches++; return { ok: true, value: { mode: 'quick' } } })
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/mobile-operator/remote.start`
  const body = JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'remote.start', payload: { confirmed: true } })
  for (const [authorization, expected] of [['', 401], ['synthetic-device', 403], ['synthetic-owner', 200]]) {
    const response = await fetch(url, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body })
    assert.equal(response.status, expected)
    await response.text()
  }
  assert.equal(dispatches, 1)
})
