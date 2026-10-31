// Imports the unchanged shipped phone SDK. No replacement transport or phone code.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { createRelay } from '../../tools/relay/server.mjs'
import { createMobileServer } from '../src/server.js'
import { createRelaySettings, OFFICIAL_RELAY } from '../src/relay-settings.mjs'
import { createRelayTransport } from '../../../ios-app/sdk/relay-transport.js'
import { MobileClient, MemoryTokenStore } from '../../../ios-app/sdk/index.js'

const until = async check => {
 const deadline = Date.now() + 5000
 while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
 throw Error('Timed out')
}

test('unchanged phone SDK with iOS default Origin pairs, refreshes, reconnects and revokes', { timeout: 20000 }, async t => {
 const home = await mkdtemp(join(tmpdir(), 'official-phone-sdk-'))
 let relay = await createRelay({ origin: OFFICIAL_RELAY, openRegistration: true })
 class LocalSocket extends WebSocket { constructor(url) { super(String(url).replace(OFFICIAL_RELAY, relay.url.replace('http:', 'ws:'))) } }
 class NativePhoneSocket extends WebSocket { constructor(url) { super(String(url).replace(OFFICIAL_RELAY, relay.url.replace('http:', 'ws:')), { origin: OFFICIAL_RELAY.replace('wss:', 'https:') }) } }
 const server = await createMobileServer({ home, config: {}, managedRemote: true, adapter: {
  capabilities: () => ({ send: true, stream: true, agents: true }), state: async () => ({ session: 'unchanged-team' }), dispose: async () => {},
 } })
 const settings = await createRelaySettings({ home, server, Socket: LocalSocket })
 const transports = [], clients = []
 t.after(async () => { clients.forEach(c => c.dispose()); transports.forEach(c => c.dispose()); await settings.dispose(); await relay.close(); await server.close(); await rm(home, { recursive: true, force: true }) })
 await settings.official()
 assert.throws(() => settings.pairing({ automatic: true }), { code: 'RELAY_NOT_READY' })
 await until(() => settings.snapshot().ready)
 const ownerQr = settings.pairing({ automatic: true, leaseId: randomUUID() })
 const { leaseId, ...qr } = ownerQr
 assert.deepEqual(Object.keys(qr).sort(), ['code', 'computerId', 'computerKey', 'expiresAt', 'relay', 'serverId', 'v'])
 assert.equal(server.url, null, 'only loopback transport exists; QR uses relay')
 const connect = (Socket = LocalSocket) => {
  const transport = createRelayTransport({ ...qr, randomBytes: n => new Uint8Array(randomBytes(n)), WebSocket: Socket })
  const store = new MemoryTokenStore()
  const client = new MobileClient({ baseUrl: transport.baseUrl, fetch: transport.fetch, WebSocket: transport.WebSocket, tokenStore: store, requestTimeoutMs: 5000 })
  transports.push(transport); clients.push(client)
  return { transport, client, store }
 }
 const { client } = connect(NativePhoneSocket)
 assert.equal((await client.info()).serverId, qr.serverId)
 const claim = await client.pair(qr.code, 'Existing mobile SDK')
 const session = await client.completePairing(claim.claimToken)
 assert.ok(session.accessToken)
 assert.ok(session.refreshToken)
 assert.equal((await client.state()).session, 'unchanged-team')
 assert.equal((await server.operator('status')).devices[0].agents, false)
 assert.equal((await server.operator('status')).pairingLease.leaseId, leaseId)
 await assert.rejects(client.pair(qr.code, 'Replay'), { code: 'INVALID_PAIRING_CODE' })
 // Closing an already completed QR retains the saved device session.
 await server.operator('pairing.cancel', { leaseId })
 assert.equal((await client.state()).session, 'unchanged-team')
 const revision = settings.snapshot().revision
 const relayPort = Number(new URL(relay.url).port)
 await relay.close()
 await until(() => !settings.snapshot().ready)
 assert.throws(() => settings.pairing({ automatic: true }), { code: 'RELAY_NOT_READY' })
 relay = await createRelay({ origin: OFFICIAL_RELAY, openRegistration: true, port: relayPort })
 await until(() => settings.snapshot().ready && settings.snapshot().revision > revision)
 assert.equal((await client.state()).session, 'unchanged-team')
 const { transport: reconnected, client: second, store } = connect()
 await store.set({ ...session, expiresAt: Date.now() - 1, serverUrl: reconnected.baseUrl })
 assert.equal((await second.state()).session, 'unchanged-team')
 const refreshed = await store.get()
 assert.equal(refreshed.deviceId, session.deviceId)
 assert.notEqual(refreshed.accessToken, session.accessToken, 'released SDK refreshed its own session')
 await server.operator('device.revoke', { id: session.deviceId })
 await assert.rejects(second.state(), { code: 'UNAUTHORIZED' })
})

test('actual official registration quota and denied registration never expose a QR', async t => {
 const root = await mkdtemp(join(tmpdir(), 'official-limits-'))
 const { mkdir } = await import('node:fs/promises')
 const relay = await createRelay({ origin: OFFICIAL_RELAY, openRegistration: true, limits: { maxComputers: 1 } })
 class LocalSocket extends WebSocket { constructor(url) { super(String(url).replace(OFFICIAL_RELAY, relay.url.replace('http:', 'ws:'))) } }
 const connections = [], servers = []
 t.after(async () => { for (const s of connections) await s.dispose(); for (const s of servers) await s.close(); await relay.close(); await rm(root, { recursive: true, force: true }) })
 for (let i = 0; i < 2; i++) {
  const home = join(root, String(i)); await mkdir(home)
  const server = await createMobileServer({ home, config: {}, managedRemote: true, adapter: { dispose: async () => {} } })
  servers.push(server)
  const settings = await createRelaySettings({ home, server, Socket: LocalSocket })
  connections.push(settings)
  await settings.official()
  await until(() => settings.snapshot().state === (i === 0 ? 'ready' : 'limited'))
 }
 assert.equal(connections[1].pairingStatus().available, false)
 assert.throws(() => connections[1].pairing({ automatic: true }), { code: 'RELAY_NOT_READY' })
 const closed = await createRelay({ origin: OFFICIAL_RELAY, secret: 'x'.repeat(32) })
 t.after(() => closed.close())
 class ClosedSocket extends WebSocket { constructor(url) { super(String(url).replace(OFFICIAL_RELAY, closed.url.replace('http:', 'ws:'))) } }
 const home = join(root, 'closed'); await mkdir(home)
 const server = await createMobileServer({ home, config: {}, managedRemote: true, adapter: { dispose: async () => {} } })
 servers.push(server)
 const settings = await createRelaySettings({ home, server, Socket: ClosedSocket })
 connections.push(settings)
 await settings.official()
 await until(() => settings.snapshot().state === 'denied')
 assert.equal(settings.pairingStatus().available, false)
 assert.throws(() => settings.pairing({ automatic: true }), { code: 'RELAY_NOT_READY' })
})
