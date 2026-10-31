import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { WebSocket } from 'ws'
import { Config } from '../src/config.mjs'
import { startBridge } from '../index.mjs'
import { createRelaySettings } from '../src/relay-settings.mjs'
import { createMobileServer } from '../src/server.js'
import { createRelay } from '../../tools/relay/server.mjs'
import { composePatch } from '../../scripts/suite-lib.mjs'

const { load } = createRequire(new URL('../fixture/deps/package.json', import.meta.url))('js-yaml')
const connection = {
  createPeer: () => ({ dispose() {} }),
  createSharedFetchHandler: () => ({ async fetch(request) {
    const { endpoint } = await request.json()
    return Response.json({ ok: true, value: endpoint === 'bridge.describe'
      ? { version: 1, stableRequestId: true, redactedText: true }
      : { bots: [], rooms: [], mainBotIds: [], models: [] } })
  } }),
}

test('runtime, schema and composed installation default to direct without public registration', async t => {
  // Assert the default before starting anything: a regression must not contact a public relay.
  assert.equal(Config({}).relay, '')
  const schema = JSON.parse(await readFile(new URL('../config.schema.json', import.meta.url), 'utf8'))
  assert.equal(schema.properties.relay.default, '')
  const bridgePatch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const enginePatch = await readFile(new URL('../../engine/cordis.patch.yml', import.meta.url), 'utf8')
  const rows = load(composePatch({ enginePatch, bridgePatch })).flatMap(row => row.insert ?? [])
  const row = rows.find(item => item.id === 'ds-bot-mobile-bridge')
  assert.equal(row.config.relay, '')
  assert.equal(row.config.enabled, false)

  const home = await mkdtemp(join(tmpdir(), 'bridge-direct-default-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const config = Config({ enabled: true, home, publicUrl: 'https://direct.example' })
  const bridge = await startBridge({ connection, sessionController: {} }, config)
  t.after(() => bridge.close())
  assert.equal((await bridge.operator('status')).relay.mode, 'direct')
  assert.equal((await bridge.operator('pairing.create')).url, 'https://direct.example')
  await assert.rejects(readFile(join(home, 'relay-identity.json')), { code: 'ENOENT' })
})

test('saved secret-required relay still pairs when the public default is disabled', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-private-relay-upgrade-'))
  const secret = randomBytes(32).toString('base64url'), origin = 'wss://private-relay.example'
  const middle = await createRelay({ origin, secret })
  const server = await createMobileServer({ home, config: { devAllowInsecure: true }, adapter: {
    capabilities: () => ({ send: true, stream: true }), dispose: async () => {},
  } })
  const saved = JSON.stringify({ version: 1, mode: 'relay', relay: origin, secret })
  await writeFile(join(home, 'relay-connection.json'), saved, { mode: 0o600 })
  class LocalSocket extends WebSocket {
    constructor(url) { super(String(url).replace(origin, middle.url.replace('http:', 'ws:'))) }
  }
  const settings = await createRelaySettings({ home, server, Socket: LocalSocket, defaultRelay: Config({}).relay })
  t.after(async () => {
    await settings.dispose(); await middle.close(); await server.close()
    await rm(home, { recursive: true, force: true })
  })
  const deadline = Date.now() + 5000
  while (!settings.snapshot().ready && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(settings.snapshot().ready, true)
  assert.equal(settings.pairing().relay, origin)
  assert.equal(JSON.stringify(settings.snapshot()).includes(secret), false)
  assert.equal(await readFile(join(home, 'relay-connection.json'), 'utf8'), saved)
})
