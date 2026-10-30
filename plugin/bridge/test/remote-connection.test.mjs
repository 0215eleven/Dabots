import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthStore } from '../src/auth.js'

test('changing a pairing address invalidates codes and pending claims without revoking approved devices', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-auth-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const auth = await createAuthStore(home)
  t.after(() => auth.close())
  const first = auth.createPairing('https://first.example')
  const claim = auth.beginPairing({ code: first.code, deviceName: 'Test phone' })
  auth.decidePairing(claim.requestId, true)
  const session = await auth.completePairing(claim.claimToken)
  const stale = auth.createPairing('https://first.example')
  const pending = auth.beginPairing({ code: stale.code, deviceName: 'Pending phone' })
  const unused = auth.createPairing('https://first.example')
  assert.equal(typeof auth.invalidatePairings, 'function', 'address changes must revoke ephemeral pairing capabilities')
  auth.invalidatePairings()
  assert.throws(() => auth.beginPairing({ code: unused.code, deviceName: 'Late phone' }), { code: 'INVALID_PAIRING_CODE' })
  assert.throws(() => auth.decidePairing(pending.requestId, true), { code: 'PAIRING_NOT_FOUND' })
  await assert.rejects(auth.completePairing(claim.claimToken), { code: 'PAIRING_NOT_FOUND' })
  assert.equal(auth.verifyAccess(session.accessToken).id, session.deviceId)
})

test('an address change during session issuance cannot return the superseded pairing credentials', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-race-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const auth = await createAuthStore(home)
  t.after(() => auth.close())
  const pairing = auth.createPairing('https://first.example')
  const claim = auth.beginPairing({ code: pairing.code, deviceName: 'Racing phone' })
  auth.decidePairing(claim.requestId, true)
  const issuing = auth.completePairing(claim.claimToken)
  auth.invalidatePairings()
  await assert.rejects(issuing, { code: 'PAIRING_NOT_FOUND' })
  assert.equal(auth.devices().filter(device => !device.revokedAt).length, 0)
})

const loadRemote = () => import('../src/remote-connection.mjs')
async function fixture(t, config = {}, { expectCleanupFailure = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'bridge-remote-settings-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  let url = config.publicUrl ?? null, starts = 0, disposed = false, onChange
  const server = { address: { address: '127.0.0.1', port: 34123 }, get url() { return url }, setPublicUrl(value) { url = value } }
  const tunnel = {
    state: { state: 'stopped', url: null, error: null },
    snapshot() { return this.state },
    async start({ confirmed }) { if (!confirmed) throw Error('confirmation required'); starts++; this.emit('starting') },
    async stop() { this.emit('stopped') },
    async dispose() { disposed = true; this.emit('stopped') },
    emit(state, nextUrl = null, error = null) { this.state = { state, url: nextUrl, error }; onChange?.(this.state) },
  }
  const { createRemoteConnection } = await loadRemote()
  const remote = await createRemoteConnection({ home, config, server, createTunnel: options => { assert.equal(options.origin, 'http://127.0.0.1:34123'); onChange = options.onChange; return tunnel } })
  t.after(async () => {
    if (expectCleanupFailure) await assert.rejects(remote.dispose(), { code: 'REMOTE_STOP_FAILED' })
    else await remote.dispose()
  })
  return { home, server, tunnel, remote, starts: () => starts, disposed: () => disposed }
}

test('legacy URL remains selected and quick mode requires explicit confirmed start on every load', async t => {
  const f = await fixture(t, { publicUrl: 'https://legacy.example' })
  assert.equal(f.remote.snapshot().mode, 'existing')
  assert.equal(f.server.url, 'https://legacy.example')
  await f.remote.configure({ mode: 'quick' })
  assert.equal(f.server.url, null)
  assert.equal(f.starts(), 0)
  await assert.rejects(f.remote.start({ confirmed: false }))
  await f.remote.start({ confirmed: true })
  assert.equal(f.starts(), 1)
  f.tunnel.emit('running', 'https://one.trycloudflare.com')
  assert.equal(f.server.url, 'https://one.trycloudflare.com')
  f.tunnel.emit('error', null, 'TUNNEL_EXITED')
  assert.equal(f.server.url, null)
  assert.equal(f.remote.snapshot().error, 'TUNNEL_EXITED')
  await f.remote.configure({ mode: 'existing' })
  assert.equal(f.server.url, 'https://legacy.example')
  assert.equal(f.starts(), 1)
  await f.remote.configure({ mode: 'quick' })
  const saved = JSON.parse(await readFile(join(f.home, 'remote-connection.json'), 'utf8'))
  assert.deepEqual(saved, { version: 1, mode: 'quick', existingUrl: 'https://legacy.example', fixedUrl: null, namedUrl: null, namedToken: null })
  const { createRemoteConnection } = await loadRemote()
  const reloaded = await createRemoteConnection({ home: f.home, config: { publicUrl: 'https://legacy.example' }, server: f.server, createTunnel: () => { throw Error('loading must not create a process manager') } })
  assert.equal(reloaded.snapshot().state, 'stopped')
  assert.equal(f.server.url, null)
  await reloaded.dispose()
})

test('only exact HTTPS origins are saved and changing modes keeps separately configured URLs', async t => {
  const f = await fixture(t, { publicUrl: 'https://legacy.example' })
  for (const url of ['http://plain.example', 'https://u:p@host.example', 'https://host.example/path', 'https://host.example/?q=x', 'https://host.example/#x', 'https://host.example?', 'https://host.example#', ' https://host.example', 'https:\\host.example', 'https://host.example\n', 'https://host.example/%2e', 'ftp://host.example']) {
    await assert.rejects(f.remote.configure({ mode: 'fixed', url }))
    assert.equal(f.server.url, 'https://legacy.example')
  }
  await f.remote.configure({ mode: 'fixed', url: 'https://fixed.example/' })
  assert.equal(f.server.url, 'https://fixed.example')
  assert.equal(f.remote.snapshot().state, 'configured')
  assert.equal(f.remote.snapshot().configuredUrl, 'https://fixed.example')
  await f.remote.configure({ mode: 'existing' })
  assert.equal(f.server.url, 'https://legacy.example')
  await f.remote.configure({ mode: 'fixed' })
  assert.equal(f.server.url, 'https://fixed.example')
  await assert.rejects(f.remote.configure({ mode: 'fixed', url: 'https://safe.example', token: 'not-accepted' }))
  await assert.rejects(f.remote.configure({ mode: 'unknown' }))
})

test('remote disposal clears temporary address and prevents later start and late callbacks', async t => {
  const f = await fixture(t)
  await f.remote.configure({ mode: 'quick' })
  await f.remote.start({ confirmed: true })
  f.tunnel.emit('running', 'https://one.trycloudflare.com')
  const revision = f.remote.snapshot().revision
  await f.remote.stop()
  assert.equal(f.server.url, null)
  assert.ok(f.remote.snapshot().revision > revision)
  await f.remote.dispose()
  assert.equal(f.disposed(), true)
  f.tunnel.emit('running', 'https://late.trycloudflare.com')
  assert.equal(f.server.url, null)
  await assert.rejects(f.remote.start({ confirmed: true }))
})

test('unconfirmed process cleanup fails visibly and records a reload block without retaining an address', async t => {
  const f = await fixture(t, {}, { expectCleanupFailure: true })
  await f.remote.configure({ mode: 'quick' })
  await f.remote.start({ confirmed: true })
  f.tunnel.emit('running', 'https://one.trycloudflare.com')
  f.tunnel.dispose = async () => { f.tunnel.emit('error', null, 'TUNNEL_STOP_FAILED'); return f.tunnel.snapshot() }
  await assert.rejects(f.remote.dispose(), { code: 'REMOTE_STOP_FAILED' })
  await assert.rejects(f.remote.dispose(), { code: 'REMOTE_STOP_FAILED' })
  assert.equal(f.server.url, null)
  assert.equal(f.remote.snapshot().state, 'error')
  assert.equal(f.remote.snapshot().error, 'REMOTE_STOP_FAILED')
  assert.deepEqual(JSON.parse(await readFile(join(f.home, 'remote-cleanup-required.json'), 'utf8')), { version: 1, reason: 'UNCONFIRMED_TUNNEL_STOP' })
})
