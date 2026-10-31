import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRelaySettings, OFFICIAL_RELAY } from '../src/relay-settings.mjs'

test('official selection keeps private record and identity but never passes the private secret', async t => {
 const home = await mkdtemp(join(tmpdir(), 'bridge-official-'))
 t.after(() => rm(home, { recursive: true, force: true }))
 const saved = JSON.stringify({ version: 1, mode: 'relay', relay: 'wss://private.example', secret: 'x'.repeat(32) })
 await writeFile(join(home, 'relay-connection.json'), saved)
 const attempts = []
 const connect = options => { attempts.push(options); options.onStatus({ state: 'ready', computerId: 'computer', computerKey: 'key' }); return { close() {} } }
 const server = { serverId: 'one', url: null, invalidatePairings() {}, createPairing: () => ({ code: 'code', expiresAt: 123, serverId: 'one' }) }
 let settings = await createRelaySettings({ home, server, connect })
 await settings.official()
 assert.equal(attempts.at(-1).relay, OFFICIAL_RELAY)
 assert.equal(attempts.at(-1).secret, null)
 assert.equal(settings.snapshot().official, true)
 assert.equal(await readFile(join(home, 'relay-connection.json'), 'utf8'), saved)
 const identity = await readFile(join(home, 'relay-identity.json'), 'utf8')
 await settings.dispose()
 settings = await createRelaySettings({ home, server, connect })
 t.after(() => settings.dispose())
 assert.equal(attempts.at(-1).secret, null)
 assert.equal(attempts.at(-1).relay, OFFICIAL_RELAY)
 assert.equal(await readFile(join(home, 'relay-identity.json'), 'utf8'), identity)
 await settings.configure({ relay: OFFICIAL_RELAY, secret: 'z'.repeat(32) })
 assert.equal(attempts.at(-1).secret, null)
})
