import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createMobileServer } from '../src/server.js'
import { createRelaySettings } from '../src/relay-settings.mjs'
import { createRelay } from '../../tools/relay/server.mjs'
import { adminMessage, createApprovals } from '../../tools/relay/approvals.mjs'
import { buildTag } from '../src/build-tag.mjs'

const OFFICIAL = 'wss://official.example'
const until = async (check, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 20)) } throw Error('Timed out') }

test('a computer the relay has not approved waits, shows its code, and connects the moment the admin approves', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-approval-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const approvals = await createApprovals({ file: join(dir, 'approvals.json'), bootstrapFile: join(dir, 'code') })
  const relay = await createRelay({ origin: OFFICIAL, port: 0, openRegistration: true, approvals })
  t.after(() => relay.close())
  class LocalSocket extends WebSocket { constructor(url) { super(String(url).replace(OFFICIAL, relay.url.replace('http:', 'ws:'))) } }
  const home = join(dir, 'home')
  const server = await createMobileServer({ home, adapter: { capabilities: () => ({}), dispose: async () => {} }, config: { devAllowInsecure: true } })
  t.after(() => server.close())
  const buildKey = 'b'.repeat(43)
  const settings = await createRelaySettings({ home, server, Socket: LocalSocket, officialRelay: OFFICIAL, buildKey })
  t.after(() => settings.dispose())
  await settings.official()
  await until(() => settings.snapshot().state === 'pending')
  const { computerId } = settings.snapshot()
  assert.match(computerId, /^[A-Za-z0-9_-]{22}$/, 'the waiting computer shows its ID for the admin')
  const pending = approvals.list().pending
  assert.equal(pending.length, 1)
  assert.equal(pending[0].computerId, computerId)
  assert.ok(pending[0].name, 'the admin sees the computer name')
  // The waiting computer already shows a code, tagged for the official app.
  const code = settings.pairing({})
  assert.equal(code.computerId, computerId)
  assert.equal(code.pending, true)
  assert.equal(code.build, buildTag(buildKey, 'plugin', code.serverId))
  // The admin phone approves (as it does when it scans that code): no reconnect is needed.
  const keys = generateKeyPairSync('ed25519'), key = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url')
  const admin = async (path, body) => {
    const text = JSON.stringify(body), time = Date.now()
    const signature = sign(null, Buffer.from(adminMessage({ origin: OFFICIAL, method: 'POST', path, time, body: Buffer.from(text) })), keys.privateKey).toString('base64url')
    const response = await fetch(relay.url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dabots-admin-key': key, 'x-dabots-admin-time': String(time), 'x-dabots-admin-signature': signature }, body: text })
    assert.equal(response.status, 200)
  }
  await admin('/v1/admin/claim', { code: (await readFile(join(dir, 'code'), 'utf8')).trim() })
  await admin('/v1/admin/approve', { computerId })
  await until(() => settings.snapshot().ready, 3000)
})
