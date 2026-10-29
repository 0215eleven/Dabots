import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once, EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { WebSocket } from 'ws'
import { apply } from '../index.mjs'
import { MobileClient, MemoryTokenStore } from '../../packages/mobile-sdk/index.js'

const OLD_URL = 'https://before.example'
const NEW_URL = 'https://after.example'

async function boundedCleanup(operation) {
  let timer
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Plugin fixture cleanup did not finish')), 5000)
    })])
  } finally { clearTimeout(timer) }
}

function inbox() {
  const events = new EventEmitter(), values = []
  return {
    values,
    push(value) { values.push(value); events.emit('value', value) },
    wait(predicate) {
      const found = values.find(predicate)
      if (found) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { events.off('value', listener); reject(Error('Expected fixture event did not arrive')) }, 5000)
        const listener = value => { if (predicate(value)) { clearTimeout(timer); events.off('value', listener); resolve(value) } }
        events.on('value', listener)
      })
    },
  }
}

// Only public host boundaries are synthetic. The production plugin entry,
// adapter projections, owner admission, pairing store and HTTP/WS server run.
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'bridge-combined-'))
  const state = {
    revision: 7, bots: [{ id: 'alpha', name: 'Alpha', sessionId: 'public-chat', parts: ['prior-chat'] }],
    rooms: [{ id: 'public-room', name: 'Room', members: ['alpha'], parts: ['private-member-chat'] }], mainBotIds: ['alpha'],
    models: [], activity: { alpha: 'thinking', outsider: 'working' },
    work: { bots: { alpha: { since: 100, tool: 'private-tool', said: 'private-content' } },
      rooms: { 'public-room': [{ botId: 'alpha', since: 200, speaking: true, path: '/private/path' }] },
      approvals: [{ id: 'approval-room', botId: 'alpha', roomId: 'public-room', sessionId: 'private-member-chat', at: 300, answerable: true, reason: 'private-content' }] },
  }
  const rows = [{ sessionId: 'public-chat', updatedAt: 500, running: true }, { sessionId: 'prior-chat', updatedAt: 450 },
    { sessionId: 'private-member-chat', updatedAt: 999, running: true }, { sessionId: 'outsider', updatedAt: 999, running: true }]
  const subscriptions = new Set(), sockets = new Set(), clients = new Set()
  let handler, cleanup, registered, startupFailed
  const registeredRoute = new Promise((resolve, reject) => { registered = resolve; startupFailed = reject })
  registeredRoute.catch(() => {})
  const sessionController = {
    list: async () => ({ items: rows }),
    async *follow({ address }, signal) {
      const subscription = { sessionId: address.sessionId, queue: [], wake: null }
      const abort = () => subscription.wake?.()
      signal.addEventListener('abort', abort, { once: true })
      subscriptions.add(subscription)
      try {
        yield { type: 'snapshot', cursor: 10, records: [
          { event: { type: 'turn/end', seq: 2, time: 20, data: { turn: 1, reason: { kind: 'completed' } } } },
          { event: { type: 'assistant/message', seq: 3, time: 30, data: { turn: 1, message: { content: [{ type: 'text', text: 'Earlier public reply' }] } } } },
        ] }
        while (!signal.aborted) {
          if (subscription.queue.length) yield subscription.queue.shift()
          else await new Promise(resolve => { subscription.wake = resolve })
        }
      } finally { signal.removeEventListener('abort', abort); subscriptions.delete(subscription) }
    },
  }
  const connection = {
    admit: request => request.headers.authorization === 'fixture-owner'
      ? { peer: { principal: { kind: 'owner' } } } : { peer: { principal: { kind: 'device' } } },
    createPeer: () => ({ dispose() {} }),
    createSharedFetchHandler: () => ({ async fetch(request) {
      const { endpoint, payload } = await request.json()
      const value = endpoint === 'state' ? state : endpoint === 'bridge.describe'
        ? { version: 1, stableRequestId: true, redactedText: true, groups: true, groupProjection: 1 }
        : endpoint === 'bridge.redact' ? { texts: payload.texts } : null
      assert.notEqual(value, null, `Unexpected upstream fixture endpoint: ${endpoint}`)
      return Response.json({ ok: true, value })
    } }),
  }
  const ownerServer = createServer((request, response) => {
    if (handler) void handler(request, response)
    else { response.writeHead(404); response.end() }
  })
  t.after(async () => {
    for (const client of clients) client.dispose()
    for (const socket of sockets) socket.terminate()
    await boundedCleanup(cleanup?.())
    ownerServer.closeAllConnections()
    if (ownerServer.listening) await new Promise(resolve => ownerServer.close(resolve))
    await rm(home, { recursive: true, force: true })
  })
  apply({ connection, sessionController,
    webServer: { register(route) { handler = route.handler; registered(); return () => { handler = null } } },
    effect(fn) { cleanup = fn() }, emit(_event, error) { startupFailed(error) },
  }, { enabled: true, home, publicUrl: OLD_URL })
  await registeredRoute
  await new Promise((resolve, reject) => { ownerServer.once('error', reject); ownerServer.listen(0, '127.0.0.1', resolve) })
  const ownerRoot = `http://127.0.0.1:${ownerServer.address().port}`
  let rpc = 0
  async function operator(method, payload = {}, owner = true) {
    const response = await fetch(`${ownerRoot}/mobile-operator/${method}`, { method: 'POST', headers: {
      'content-type': 'application/json', ...(owner ? { authorization: 'fixture-owner' } : {}),
    }, body: JSON.stringify({ type: 'client-request', rpcId: String(++rpc), method, payload }) })
    if (response.status !== 200) { await response.text(); return { status: response.status } }
    const { result } = await response.json()
    assert.equal(result.ok, true)
    return result.value
  }
  const status = await operator('status'), root = status.remote.loopbackUrl
  assert.match(root, /^http:\/\/127\.0\.0\.1:\d+$/)
  async function mobile(path, { json, token } = {}) {
    const response = await fetch(root + '/mobile/v1' + path, {
      method: json === undefined ? 'GET' : 'POST', headers: { ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    })
    return { status: response.status, body: await response.json() }
  }
  async function pair(name) {
    const qr = await operator('pairing.create')
    const claim = (await mobile('/pairings', { json: { code: qr.code, deviceName: name } })).body
    assert.equal((await mobile('/pairings/complete', { json: { claimToken: claim.claimToken } })).body.status, 'pending')
    await operator('pairing.approve', { requestId: claim.requestId })
    return (await mobile('/pairings/complete', { json: { claimToken: claim.claimToken } })).body
  }
  async function stream(token, extra = {}) {
    const socket = new WebSocket(root.replace('http:', 'ws:') + '/mobile/v1/events'), frames = inbox()
    sockets.add(socket)
    socket.on('message', bytes => frames.push(JSON.parse(bytes.toString())))
    await once(socket, 'open')
    socket.send(JSON.stringify({ type: 'auth', token, conversationId: 'alpha', ...extra }))
    await frames.wait(frame => frame.type === 'ready')
    return { socket, frames }
  }
  return { status, root, state, rows, operator, mobile, pair, stream, sockets, clients,
    cleanupPlugin: () => cleanup(), activeFollows: () => subscriptions.size,
    publish(event) { for (const subscription of subscriptions) if (subscription.sessionId === 'public-chat') { subscription.queue.push({ type: 'event', event }); subscription.wake?.() } },
  }
}

test('owner address change expires pending pairing while an authenticated running conversation retains scoped work and live outcomes', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  assert.equal(f.status.capabilities.taskEvents, true)
  const session = await f.pair('Synthetic approved phone'), live = await f.stream(session.accessToken)
  const reset = await live.frames.wait(frame => frame.type === 'reset')
  assert.equal(reset.busy, true); assert.equal(reset.phase, 'running')
  assert.deepEqual(reset.messages.map(item => item.text), ['Earlier public reply'])
  assert.equal(live.frames.values.some(frame => frame.taskEvent), false, 'historical completion is not replayed on reconnect')
  const before = (await f.mobile('/state', { token: session.accessToken })).body
  assert.deepEqual(before.activity, { alpha: 'thinking' })
  assert.deepEqual(before.work.rooms, { 'public-room': [{ botId: 'alpha', since: 200, speaking: true }] })
  assert.equal(before.taskEvents[0].taskEvent.kind, 'approval-required')
  const pendingQr = await f.operator('pairing.create')
  const pending = (await f.mobile('/pairings', { json: { code: pendingQr.code, deviceName: 'Pending phone' } })).body
  const unusedQr = await f.operator('pairing.create')
  assert.deepEqual(await f.operator('remote.configure', { mode: 'fixed', url: NEW_URL }, false), { status: 403 })
  await f.operator('remote.configure', { mode: 'fixed', url: NEW_URL })
  assert.equal((await f.operator('status')).serverId, session.serverId)
  assert.equal((await f.mobile('/pairings', { json: { code: unusedQr.code, deviceName: 'Stale phone' } })).body.error.code, 'INVALID_PAIRING_CODE')
  assert.equal((await f.mobile('/pairings/complete', { json: { claimToken: pending.claimToken } })).body.error.code, 'PAIRING_NOT_FOUND')
  assert.equal((await f.operator('pairing.create')).url, NEW_URL)
  const after = (await f.mobile('/state', { token: session.accessToken })).body
  assert.deepEqual(after.work, before.work)
  assert.deepEqual(after.taskEvents, before.taskEvents)
  const conversation = (await f.mobile('/conversations', { token: session.accessToken })).body.conversations.find(item => item.id === 'alpha')
  assert.equal(conversation.updatedAt, 500); assert.equal(conversation.busy, true)
  f.publish({ type: 'turn/end', seq: 11, time: 600, data: { turn: 2, reason: { kind: 'error', error: { message: 'private-content' } } } })
  const ended = await live.frames.wait(frame => frame.taskEvent?.kind === 'failed')
  assert.equal(ended.busy, false); assert.equal(ended.sessionId, 'public-chat'); assert.equal(ended.conversationId, 'alpha')
  for (const secret of ['private-content', 'private-member-chat', '/private/path', 'private-tool', 'outsider']) {
    assert.equal(JSON.stringify({ after, ended, reset, conversation }).includes(secret), false)
  }
  assert.equal(live.socket.readyState, WebSocket.OPEN)
  assert.equal(f.activeFollows(), 1)
  const closed = once(live.socket, 'close')
  await boundedCleanup(Promise.all([f.cleanupPlugin(), closed]))
  assert.equal(live.socket.readyState, WebSocket.CLOSED)
  assert.equal(f.activeFollows(), 0)
  assert.deepEqual(await f.operator('status'), { status: 404 })
})

test('same serverId after an owner URL change cannot move old HTTP or WebSocket credentials; fresh pairing restores continuity', { timeout: 10000 }, async t => {
  const f = await fixture(t), requests = [], socketDestinations = []
  const mappedFetch = (url, init) => {
    const destination = new URL(url)
    assert.ok([OLD_URL, NEW_URL].includes(destination.origin), 'fixture refuses all external destinations')
    const body = init.body ? JSON.parse(init.body) : {}
    requests.push({ origin: destination.origin, path: destination.pathname, authenticated: Boolean(init.headers.Authorization), refresh: Boolean(body.refreshToken) })
    return fetch(f.root + destination.pathname + destination.search, init)
  }
  class MappedSocket extends WebSocket {
    constructor(url) {
      const destination = new URL(url)
      assert.ok(['wss://before.example', 'wss://after.example'].includes(destination.origin))
      socketDestinations.push(destination.origin)
      super(f.root.replace('http:', 'ws:') + destination.pathname)
      f.sockets.add(this)
    }
  }
  const store = new MemoryTokenStore()
  const client = baseUrl => {
    const value = new MobileClient({ baseUrl, tokenStore: store, fetch: mappedFetch, WebSocket: MappedSocket })
    f.clients.add(value); return value
  }
  const original = client(OLD_URL), qr = await f.operator('pairing.create'), claim = await original.pair(qr.code, 'Synthetic SDK phone')
  await f.operator('pairing.approve', { requestId: claim.requestId })
  const approved = await original.completePairing(claim.claimToken)
  assert.equal((await store.get()).serverUrl, OLD_URL)
  await f.operator('remote.configure', { mode: 'fixed', url: NEW_URL })
  const candidate = client(NEW_URL)
  assert.equal((await candidate.info()).serverId, approved.serverId)
  // Expiry must not turn an address mismatch into a refresh-token migration.
  await store.set({ ...await store.get(), expiresAt: Date.now() - 1000 })
  await assert.rejects(candidate.state(), { code: 'server_changed' })
  const errors = inbox(), rejected = candidate.connect({ conversationId: 'alpha', onEvent() {}, onError: error => errors.push(error) })
  assert.equal((await errors.wait(error => error.code === 'server_changed')).code, 'server_changed')
  rejected.close()
  assert.deepEqual(socketDestinations, [])
  assert.deepEqual(requests.filter(request => request.origin === NEW_URL), [{ origin: NEW_URL, path: '/mobile/v1/info', authenticated: false, refresh: false }])
  assert.equal((await store.get()).serverUrl, OLD_URL)
  const replacementQr = await f.operator('pairing.create'), replacement = await candidate.pair(replacementQr.code, 'Explicitly paired new address')
  assert.equal((await candidate.completePairing(replacement.claimToken)).status, 'pending')
  await f.operator('pairing.approve', { requestId: replacement.requestId })
  const renewed = await candidate.completePairing(replacement.claimToken)
  assert.equal(renewed.serverId, approved.serverId); assert.notEqual(renewed.deviceId, approved.deviceId)
  assert.equal((await store.get()).serverUrl, NEW_URL)
  assert.deepEqual((await candidate.state()).activity, { alpha: 'thinking' })
  const frames = inbox(), live = candidate.connect({ conversationId: 'alpha', onEvent: event => frames.push(event) })
  t.after(() => live.close())
  const reset = await frames.wait(frame => frame.type === 'reset')
  assert.equal(reset.busy, true); assert.equal(reset.sessionId, 'public-chat')
  assert.deepEqual(socketDestinations, ['wss://after.example'])
})

test('protocol 2 streams announce themselves, accept only bounded acknowledgements of sent sequences, and legacy phones stay strict', { timeout: 10000 }, async t => {
  const f = await fixture(t), session = await f.pair('Synthetic protocol 2 phone')
  const legacy = await f.stream(session.accessToken)
  assert.equal(legacy.frames.values.find(frame => frame.type === 'ready').protocol, undefined)
  const legacyClosed = once(legacy.socket, 'close')
  legacy.socket.send(JSON.stringify({ type: 'ack', seq: 1 }))
  assert.equal((await legacyClosed)[0], 4400)

  const live = await f.stream(session.accessToken, { protocol: 2 })
  const ready = live.frames.values.find(frame => frame.type === 'ready')
  assert.equal(ready.protocol, 2); assert.equal(ready.heartbeatMs, 15000)
  f.publish({ type: 'turn/end', seq: 21, time: 700, data: { turn: 3, reason: { kind: 'completed' } } })
  const ended = await live.frames.wait(frame => frame.taskEvent && Number.isSafeInteger(frame.eventSeq))
  live.socket.send(JSON.stringify({ type: 'ack', seq: ended.eventSeq }))
  live.socket.send(JSON.stringify({ type: 'ack', seq: ended.eventSeq }))
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(live.socket.readyState, WebSocket.OPEN)
  // An acknowledgement for a sequence the host never sent is a protocol violation.
  const closed = once(live.socket, 'close')
  live.socket.send(JSON.stringify({ type: 'ack', seq: ended.eventSeq + 1000 }))
  assert.equal((await closed)[0], 4400)
  await boundedCleanup(f.cleanupPlugin())
})
