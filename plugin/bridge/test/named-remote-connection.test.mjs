import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNamedTunnel } from '../src/named-tunnel.mjs'
import { assertRemoteCleanupSafe, createRemoteConnection } from '../src/remote-connection.mjs'

const token = 'test-only-cloudflare-token-not-a-real-account-credential'
const url = 'https://phone.example'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) {
  const end = Date.now() + 3000
  while (!predicate()) { assert.ok(Date.now() < end); await pause(2) }
}
async function fixture(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'named-remote-test-'))
  const children = [], managers = [], calls = []
  const server = { address: { address: '127.0.0.1', port: 34123 }, url: 'https://old.example', setPublicUrl(value) { this.url = value } }
  const createNamed = args => {
    calls.push(args)
    const manager = createNamedTunnel({ ...args, startupTimeoutMs: 2000, stopTimeoutMs: 10, restartDelayMs: 5,
      spawnImpl() {
        const child = new EventEmitter()
        Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), kills: [] })
        child.kill = signal => { child.kills.push(signal); if (options.autoClose !== false) queueMicrotask(() => child.emit('close', 0, signal)); return true }
        children.push(child); return child
      } })
    managers.push(manager)
    return manager
  }
  const remote = await createRemoteConnection({ home, server, createNamed })
  const remotes = [remote]
  t.after(async () => {
    for (const child of children) child.emit('close')
    for (const target of remotes) await target.dispose().catch(() => {})
    for (const manager of managers) await manager.dispose()
    await rm(home, { recursive: true, force: true })
  })
  return { home, server, remote, children, calls, managers,
    async reload() { await remote.dispose(); const next = await createRemoteConnection({ home, server, createNamed }); remotes.push(next); return next } }
}

test('named configuration persists privately, returns no token and keeps a saved token on URL edits', async t => {
  const f = await fixture(t)
  const saved = await f.remote.configure({ mode: 'named', url, token })
  assert.equal(saved.tokenSet, true)
  assert.equal(JSON.stringify(saved).includes(token), false)
  assert.equal(f.calls.length, 0)
  const path = join(f.home, 'remote-connection.json')
  assert.equal(JSON.parse(await readFile(path, 'utf8')).namedToken, token)
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
  await f.remote.configure({ mode: 'named', url: 'https://changed.example' })
  assert.equal(JSON.parse(await readFile(path, 'utf8')).namedToken, token)
  assert.equal(f.remote.snapshot().configuredUrl, 'https://changed.example')
})

test('named startup, stop and mode switch publish only a registered public address', async t => {
  const f = await fixture(t)
  await f.remote.configure({ mode: 'named', url, token })
  await assert.rejects(f.remote.start(), { code: 'EXPOSURE_CONFIRMATION_REQUIRED' })
  await f.remote.start({ confirmed: true })
  assert.equal(f.calls[0].token, token)
  assert.equal(f.server.url, null)
  f.children[0].stderr.write('Registered tunnel connection connIndex=0\n')
  assert.equal(f.server.url, url)
  await f.remote.stop()
  assert.equal(f.server.url, null)
  assert.equal(f.remote.snapshot().state, 'stopped')
  await f.remote.start({ confirmed: true })
  f.children[1].stderr.write('Registered tunnel connection connIndex=0\n')
  await f.remote.configure({ mode: 'fixed', url: 'https://fixed.example' })
  assert.equal(f.managers[1].snapshot().state, 'stopped')
  assert.equal(f.server.url, 'https://fixed.example')
  f.children[1].stderr.write('Registered tunnel connection connIndex=0\n')
  assert.equal(f.server.url, 'https://fixed.example')
})

test('saved named mode starts after reload without returning stored credentials', async t => {
  const f = await fixture(t)
  await f.remote.configure({ mode: 'named', url, token })
  const loaded = await f.reload()
  await until(() => f.children.length === 1)
  assert.equal(f.calls[0].url, url)
  f.children[0].stderr.write('Registered tunnel connection connIndex=0\n')
  assert.equal(loaded.snapshot().state, 'running')
  assert.equal(JSON.stringify(loaded.snapshot()).includes(token), false)
})

test('missing or invalid tokens and non-loopback named mode are refused without launching', async t => {
  const f = await fixture(t)
  await assert.rejects(f.remote.configure({ mode: 'named', url }), { code: 'REMOTE_TOKEN_REQUIRED' })
  await assert.rejects(f.remote.configure({ mode: 'named', url, token: 'short' }), { code: 'INVALID_TUNNEL_TOKEN' })
  const remote = await createRemoteConnection({ home: f.home, server: { ...f.server, address: { address: '0.0.0.0', port: 34123 } } })
  t.after(() => remote.dispose())
  await assert.rejects(remote.configure({ mode: 'named', url, token }), { code: 'QUICK_LOOPBACK_REQUIRED' })
  assert.equal(f.children.length, 0)
})

test('an unconfirmed named stop blocks mode changes and retains its process manager', async t => {
  const f = await fixture(t, { autoClose: false })
  await f.remote.configure({ mode: 'named', url, token })
  await f.remote.start({ confirmed: true })
  await assert.rejects(f.remote.configure({ mode: 'fixed', url: 'https://fixed.example' }), { code: 'REMOTE_STOP_FAILED' })
  assert.equal(f.remote.snapshot().mode, 'named')
  assert.equal(f.server.url, null)
  assert.equal(JSON.parse(await readFile(join(f.home, 'remote-connection.json'), 'utf8')).mode, 'named')
  await assert.rejects(f.remote.start({ confirmed: true }), { code: 'TUNNEL_STOPPING' })
  assert.equal(f.children.length, 1)
})

test('failed named disposal persists a reload blocker instead of silently dropping the child', async t => {
  const f = await fixture(t, { autoClose: false })
  await f.remote.configure({ mode: 'named', url, token })
  await f.remote.start({ confirmed: true })
  await assert.rejects(f.remote.dispose(), { code: 'REMOTE_STOP_FAILED' })
  await assert.rejects(assertRemoteCleanupSafe(f.home), { code: 'REMOTE_CLEANUP_REQUIRED' })
  assert.equal(f.server.url, null)
})
