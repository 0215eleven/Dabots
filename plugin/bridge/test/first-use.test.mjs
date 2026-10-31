import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { apply } from '../index.mjs'

const connection = {
 createPeer: () => ({ dispose() {} }),
 createSharedFetchHandler: () => ({ async fetch(request) {
  const { endpoint } = await request.json()
  return Response.json({ ok: true, value: endpoint === 'bridge.describe' ? { version: 1, stableRequestId: true, redactedText: true } : { bots: [], rooms: [], mainBotIds: [], models: [] } })
 } }),
 admit: request => ({ peer: { principal: { kind: request.headers.authorization === 'owner' ? 'owner' : 'device' } } }),
}

test('fresh install stays inert; owner first use provisions isolated storage and loopback, survives restart', async t => {
 const root = await mkdtemp(join(tmpdir(), 'bridge-first-use-'))
 const prior = process.env.DSH_HOME
 process.env.DSH_HOME = root
 t.after(async () => { if (prior === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prior; await rm(root, { recursive: true, force: true }) })
 let handler, cleanup
 const ctx = { connection, sessionController: {}, webServer: { register(route) { handler = route.handler; return () => {} } }, effect(fn) { cleanup = fn() } }
 apply(ctx, {})
 const host = createServer((req, res) => { void handler(req, res) })
 await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
 t.after(async () => { await cleanup(); await new Promise(resolve => host.close(resolve)) })
 const call = async (method, payload = {}, owner = true) => {
  for (let i = 0; !handler && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5))
  const response = await fetch(`http://127.0.0.1:${host.address().port}/mobile-operator/${method}`, { method: 'POST', headers: { authorization: owner ? 'owner' : 'phone', 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }) })
  return response.status === 403 ? { error: { code: 'OPERATOR_REQUIRED' } } : (await response.json()).result
 }
 assert.equal((await call('status')).value.reason, 'OFFICIAL_AVAILABLE')
 assert.deepEqual(await readdir(root), [])
 assert.equal((await call('relay.select', { mode: 'direct' }, false)).error.code, 'OPERATOR_REQUIRED')
 assert.deepEqual(await readdir(root), [])
 assert.equal((await call('relay.select', { mode: 'direct' })).ok, true)
 const state = (await call('status')).value
 assert.equal(state.enabled, true)
 assert.equal(state.url, null)
 const home = join(root, 'data', 'ds-bot-mobile-bridge')
 const identity = JSON.parse(await readFile(join(home, 'bridge.json'), 'utf8')).serverId
 assert.equal(identity, state.serverId)
 await cleanup()
 handler = null
 apply(ctx, {})
 const restarted = (await call('status')).value
 assert.equal(restarted.enabled, true)
 assert.equal(restarted.serverId, identity)
})

test('failed automatic resume retains a safe owner retry route and recovers without restart', async t => {
 const home = await mkdtemp(join(tmpdir(), 'bridge-start-retry-'))
 const { writeFile } = await import('node:fs/promises')
 await writeFile(join(home, 'relay-selection.json'), JSON.stringify({ version: 1, mode: 'direct' }))
 let handler, cleanup, fail = true
 const errors = []
 const ctx = { connection: { ...connection, createSharedFetchHandler() { if (fail) throw Error('private storage detail'); return connection.createSharedFetchHandler() } }, sessionController: {}, webServer: { register(route) { handler = route.handler; return () => {} } }, effect(fn) { cleanup = fn() }, emit(_event, error) { errors.push(error) } }
 apply(ctx, { home })
 for (let i = 0; !handler && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5))
 assert.equal(typeof handler, 'function')
 const host = createServer((req, res) => { void handler(req, res) })
 await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
 t.after(async () => { await cleanup(); await new Promise(resolve => host.close(resolve)); await rm(home, { recursive: true, force: true }) })
 const call = async (method, payload = {}) => (await (await fetch(`http://127.0.0.1:${host.address().port}/mobile-operator/${method}`, { method: 'POST', headers: { authorization: 'owner', 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'retry', method, payload }) })).json()).result
 const failed = (await call('status')).value
 assert.equal(failed.reason, 'BRIDGE_START_FAILED')
 assert.equal(JSON.stringify(failed).includes('private storage detail'), false)
 assert.equal(errors.length, 1)
 fail = false
 assert.equal((await call('relay.select', { mode: 'direct' })).ok, true)
 assert.equal((await call('status')).value.enabled, true)
})
