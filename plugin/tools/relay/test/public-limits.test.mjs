import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { generateKeyPairSync, createHash, randomBytes, sign } from 'node:crypto'
import WebSocket from 'ws'
import { createRelay } from '../server.mjs'

const origin = 'wss://fixture.example'
function identity() {
  const keys = generateKeyPairSync('ed25519')
  const edPublicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url')
  return { keys, edPublicKey, computerKey: randomBytes(32).toString('base64url'), computerId: createHash('sha256').update(Buffer.from(edPublicKey, 'base64url')).digest().subarray(0, 16).toString('base64url') }
}
async function fixture(t, options = {}) {
  const relay = await createRelay({ origin, openRegistration: true, trustedProxyIp: '127.0.0.1', ...options })
  t.after(() => relay.close())
  return relay
}
async function register(relay, { id = identity(), ip = '198.51.100.1' } = {}) {
  const ws = new WebSocket(relay.url + '/v1/computer', { headers: { 'x-real-ip': ip } })
  ws.on('error', () => {})
  const first = await Promise.race([once(ws, 'message').then(([data]) => ({ data })), once(ws, 'unexpected-response').then(([, response]) => { response.resume(); return { http: response.statusCode } })])
  if (first.http) { ws.terminate(); return first }
  const { nonce } = JSON.parse(first.data)
  const response = Promise.race([once(ws, 'message').then(([data]) => ({ message: JSON.parse(data) })), once(ws, 'close').then(([code, reason]) => ({ code, reason: reason.toString() }))])
  ws.send(JSON.stringify({ type: 'register', nonce, edPublicKey: id.edPublicKey, computerKey: id.computerKey, computerId: id.computerId, signature: sign(null, Buffer.from(JSON.stringify(['ds-bot-computer-v2', origin, nonce, id.computerId, id.edPublicKey, id.computerKey])), id.keys.privateKey).toString('base64url') }))
  return { ws, id, ...await response }
}
async function rejectUpgrade(relay, path, ip = '198.51.100.2') {
  const ws = new WebSocket(relay.url + path, { headers: { 'x-real-ip': ip } }); ws.on('error', () => {})
  const [, response] = await once(ws, 'unexpected-response'); response.resume(); ws.terminate(); return response.statusCode
}

test('public limits reject invalid or unbounded config before listening', async () => {
  for (const limits of [{ maxConnections: 0 }, { registrationPerHour: Infinity }, { bytesPerMinute: -1 }, { streamsPerComputer: 1.5 }, { unknown: 2 }]) {
    await assert.rejects(createRelay({ origin, openRegistration: true, limits }), /limit/i)
  }
  for (const blockedIps of [['198.51.100.0/24'], ['invalid']]) await assert.rejects(createRelay({ origin, openRegistration: true, blockedIps }), /blockedIps/)
  await assert.rejects(createRelay({ origin, openRegistration: true, blockedComputers: ['bad'] }), /blockedComputers/)
})

test('public successful registrations are limited per IP even with a fresh signed identity', async t => {
  const relay = await fixture(t, { limits: { registrationPerIpPerHour: 1, registrationPerHour: 2 } })
  const first = await register(relay); assert.equal(first.message.type, 'registered')
  const second = await register(relay); assert.equal(second.code, 4429); assert.equal(second.reason, 'REGISTRATION_LIMIT')
  const other = await register(relay, { ip: '198.51.100.2' }); assert.equal(other.message.type, 'registered')
})

test('public global registration quota survives disconnects and rejects fresh IPs', async t => {
  const relay = await fixture(t, { limits: { registrationPerHour: 1 } })
  const first = await register(relay); assert.equal(first.message.type, 'registered')
  const closed = once(first.ws, 'close'); first.ws.close(); await closed
  const second = await register(relay, { ip: '198.51.100.2' }); assert.equal(second.code, 4429)
})

test('global active connections and computer capacity have separate limits', async t => {
  const relay = await fixture(t, { limits: { maxConnections: 2, maxComputers: 1 } })
  const first = await register(relay); assert.equal(first.message.type, 'registered')
  const second = await register(relay, { ip: '198.51.100.2' }); assert.equal(second.code, 4429); assert.equal(second.reason, 'CAPACITY_LIMIT')
  const phone = new WebSocket(relay.url + '/v1/phone?computer=' + first.id.computerId, { headers: { 'x-real-ip': '198.51.100.3' } }); phone.on('error', () => {})
  await once(phone, 'message')
  assert.equal(await rejectUpgrade(relay, '/v1/computer', '198.51.100.4'), 429)
})

test('new connection attempt quota also applies globally across different IPs', async t => {
  const relay = await fixture(t, { limits: { connectionsPerMinute: 1 } })
  assert.equal(await rejectUpgrade(relay, '/v1/phone?computer=missing'), 409)
  assert.equal(await rejectUpgrade(relay, '/v1/phone?computer=missing', '198.51.100.3'), 429)
})

test('per computer phone stream capacity is finite', async t => {
  const relay = await fixture(t, { limits: { streamsPerComputer: 1 } })
  const computer = await register(relay)
  const phone = new WebSocket(relay.url + '/v1/phone?computer=' + computer.id.computerId, { headers: { 'x-real-ip': '198.51.100.2' } }); phone.on('error', () => {})
  await once(phone, 'message')
  assert.equal(await rejectUpgrade(relay, '/v1/phone?computer=' + computer.id.computerId, '198.51.100.3'), 429)
})

test('computer traffic quota counts encrypted data in both directions', async t => {
  const relay = await fixture(t, { limits: { bytesPerComputerPerMinute: 36 } })
  const computer = await register(relay)
  const opened = once(computer.ws, 'message')
  const phone = new WebSocket(relay.url + '/v1/phone?computer=' + computer.id.computerId, { headers: { 'x-real-ip': '198.51.100.2' } }); phone.on('error', () => {})
  await once(phone, 'message'); const [{ streamId }] = (await opened).map(data => JSON.parse(data))
  const received = once(computer.ws, 'message'); phone.send(Buffer.alloc(10)); await received
  const closed = once(computer.ws, 'close'); computer.ws.send(Buffer.concat([Buffer.from(streamId, 'base64url'), Buffer.alloc(11)]))
  assert.equal((await closed)[0], 4429)
})

test('per IP and global ingress byte quotas include unregistered clients', async t => {
  for (const limits of [{ bytesPerIpPerMinute: 8 }, { bytesPerMinute: 8 }]) {
    const relay = await fixture(t, { limits })
    const ws = new WebSocket(relay.url + '/v1/computer'); ws.on('error', () => {}); await once(ws, 'message')
    const closed = once(ws, 'close'); ws.send('012345678'); assert.equal((await closed)[0], 4429)
  }
})

test('zero byte messages still consume the finite frame quota', async t => {
  const relay = await fixture(t, { limits: { framesPerIpPerMinute: 2 } })
  const computer = await register(relay)
  const phone = new WebSocket(relay.url + '/v1/phone?computer=' + computer.id.computerId, { headers: { 'x-real-ip': '198.51.100.2' } }); phone.on('error', () => {}); await once(phone, 'message')
  const closed = once(phone, 'close')
  for (let i = 0; i < 3; i++) phone.send(Buffer.alloc(0))
  assert.equal((await closed)[0], 4429)
})

test('IP and signed computer deny lists are enforced without weakening signature checks', async t => {
  const id = identity(), relay = await fixture(t, { blockedIps: ['198.51.100.7'], blockedComputers: [id.computerId] })
  assert.equal(await rejectUpgrade(relay, '/v1/computer', '198.51.100.7'), 403)
  const blocked = await register(relay, { id }); assert.equal(blocked.code, 4403)
  const allowed = await register(relay, { ip: '198.51.100.8' }); assert.equal(allowed.message.type, 'registered')
})
