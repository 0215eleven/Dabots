import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createMobileServer } from '../src/server.js'
import { createRelaySettings } from '../src/relay-settings.mjs'
import { createRelay } from '../../tools/relay/server.mjs'
import { createApprovals } from '../../tools/relay/approvals.mjs'

const OFFICIAL = 'wss://official.example'
const until = async (check, timeout = 8000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 20)) } throw Error('Timed out') }

test('a computer the relay has not approved waits as pending, named, and connects once approved', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-approval-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const approvals = await createApprovals({ file: join(dir, 'approvals.json') })
  const relay = await createRelay({ origin: OFFICIAL, port: 0, openRegistration: true, approvals })
  t.after(() => relay.close())
  class LocalSocket extends WebSocket { constructor(url) { super(String(url).replace(OFFICIAL, relay.url.replace('http:', 'ws:'))) } }
  const home = join(dir, 'home')
  const server = await createMobileServer({ home, adapter: { capabilities: () => ({}), dispose: async () => {} }, config: { devAllowInsecure: true } })
  t.after(() => server.close())
  const settings = await createRelaySettings({ home, server, Socket: LocalSocket, officialRelay: OFFICIAL })
  t.after(() => settings.dispose())
  await settings.official()
  await until(() => settings.snapshot().state === 'pending')
  const { computerId } = settings.snapshot()
  assert.match(computerId, /^[A-Za-z0-9_-]{22}$/, 'the waiting computer shows its ID for the admin')
  const pending = approvals.list().pending
  assert.equal(pending.length, 1)
  assert.equal(pending[0].computerId, computerId)
  assert.ok(pending[0].name, 'the admin sees the computer name')
  await approvals.approve(computerId)
  // The plugin retries a pending registration every minute; choosing official again retries now.
  await settings.official()
  await until(() => settings.snapshot().ready)
})
