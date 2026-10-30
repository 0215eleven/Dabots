import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createNamedTunnel } from '../src/named-tunnel.mjs'

const token = 'test-only-named-tunnel-token-that-is-never-a-real-credential'
const url = 'https://phone.example'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) {
  const end = Date.now() + 3000
  while (!predicate()) {
    assert.ok(Date.now() < end, 'named tunnel did not reach the expected state')
    await pause(2)
  }
}
function fixture(t, options = {}) {
  const children = [], calls = [], changes = []
  const tunnel = createNamedTunnel({ url, token, startupTimeoutMs: 2000, stopTimeoutMs: 20, restartDelayMs: 5,
    spawnImpl(command, args, settings) {
      const child = new EventEmitter()
      Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), kills: [] })
      child.kill = signal => { child.kills.push(signal); if (options.autoClose !== false) queueMicrotask(() => child.emit('close', 0, signal)); return true }
      children.push(child); calls.push({ command, args, settings })
      return child
    }, onChange: value => changes.push(value), ...options })
  t.after(async () => { const stopping = tunnel.dispose(); for (const child of children) child.emit('close'); await stopping })
  return { tunnel, children, calls, changes }
}

test('configured token reaches only the isolated child environment, never argv or public state', async t => {
  const f = fixture(t, { env: { PATH: 'fixture-path', TUNNEL_TOKEN: 'inherited-secret', TUNNEL_LOGFILE: 'private-log', HTTPS_PROXY: 'private-proxy' } })
  assert.equal(f.calls.length, 0)
  await f.tunnel.start()
  const { command, args, settings } = f.calls[0]
  assert.equal(command, 'cloudflared')
  assert.equal(args.includes('--token'), false)
  assert.equal(args.some(value => value.includes(token)), false)
  assert.equal(settings.env.TUNNEL_TOKEN, token)
  assert.equal(settings.env.PATH, 'fixture-path')
  assert.equal(settings.env.TUNNEL_LOGFILE, undefined)
  assert.equal(settings.env.HTTPS_PROXY, undefined)
  assert.equal(settings.shell, false)
  assert.equal(JSON.stringify(f.changes).includes(token), false)
})

test('registration accepts split log chunks and duplicate starts share one process', async t => {
  const f = fixture(t)
  await Promise.all([f.tunnel.start(), f.tunnel.start()])
  assert.equal(f.calls.length, 1)
  f.children[0].stderr.write('Registered tunnel connec')
  assert.equal(f.tunnel.snapshot().state, 'starting')
  f.children[0].stderr.write('tion connIndex=0\n')
  assert.deepEqual(f.tunnel.snapshot(), { state: 'running', url, error: null })
  await f.tunnel.start(); assert.equal(f.calls.length, 1)
})

test('definite authentication errors are terminal and do not retry', async t => {
  for (const message of ['Invalid tunnel secret', 'Unauthorized: Failed to get tunnel', 'Provided Tunnel token is not valid.', '2026-10-30T10:00:00Z ERR Register tunnel error from server side error="Unauthorized: Invalid tunnel secret" connIndex=0']) {
    const f = fixture(t)
    await f.tunnel.start()
    f.children[0].stderr.write(`${message} ${token}\n`)
    f.children[0].emit('close', 1)
    await until(() => f.tunnel.snapshot().state === 'error')
    assert.equal(f.tunnel.snapshot().error, 'TUNNEL_UNAUTHORIZED', message)
    await pause(20)
    assert.equal(f.calls.length, 1)
    assert.equal(JSON.stringify(f.changes).includes(token), false)
    await f.tunnel.dispose()
  }
})

test('a request destination containing Unauthorized cannot stop an authenticated tunnel', async t => {
  const f = fixture(t)
  await f.tunnel.start()
  f.children[0].stderr.write('Registered tunnel connection connIndex=0\n')
  f.children[0].stderr.write('2026-10-30T10:00:00Z ERR Request failed error="dial tcp 127.0.0.1:34123: connect: connection refused" connIndex=0 dest=https://phone.example/Unauthorized event=0 type=http\n')
  assert.deepEqual(f.tunnel.snapshot(), { state: 'running', url, error: null })
  assert.deepEqual(f.children[0].kills, [])
})

test('authentication rejection promptly terminates a child that has not exited', async t => {
  const f = fixture(t)
  await f.tunnel.start()
  f.children[0].stderr.write('Unauthorized: Failed to get tunnel\n')
  await until(() => f.children[0].kills.length > 0)
  assert.deepEqual(f.children[0].kills, ['SIGTERM'])
  await until(() => f.tunnel.snapshot().state === 'error')
  assert.equal(f.tunnel.snapshot().error, 'TUNNEL_UNAUTHORIZED')
  await pause(20)
  assert.equal(f.calls.length, 1)
})

test('ordinary edge failures are retried and are not labeled authentication failures', async t => {
  const f = fixture(t, { maxRestarts: 1 })
  await f.tunnel.start()
  f.children[0].stderr.write('failed to connect to the edge: timeout\n')
  f.children[0].emit('close', 1)
  await until(() => f.children.length === 2)
  f.children[1].stderr.write('Bad response: 503; failed to run tunnel\n')
  f.children[1].emit('close', 1)
  await until(() => f.tunnel.snapshot().state === 'error')
  assert.equal(f.tunnel.snapshot().error, 'TUNNEL_EXITED')
  assert.equal(f.calls.length, 2)
})

test('each successful registration resets the consecutive restart budget', async t => {
  const f = fixture(t, { maxRestarts: 1 })
  await f.tunnel.start()
  for (let index = 0; index < 3; index++) {
    f.children[index].stderr.write('Registered tunnel connection connIndex=0\n')
    assert.equal(f.tunnel.snapshot().state, 'running')
    f.children[index].emit('close', 1)
    await until(() => f.children.length === index + 2)
  }
  assert.equal(f.calls.length, 4)
})

test('consecutive unsuccessful launches exhaust a bounded restart budget', async t => {
  const f = fixture(t, { maxRestarts: 2 })
  await f.tunnel.start()
  for (let index = 0; index < 2; index++) {
    f.children[index].emit('close', 1)
    await until(() => f.children.length === index + 2)
  }
  f.children[2].emit('close', 1)
  await until(() => f.tunnel.snapshot().state === 'error')
  await pause(20)
  assert.equal(f.calls.length, 3)
})

test('missing executable is terminal and subprocess errors remain sanitized', async t => {
  const f = fixture(t)
  await f.tunnel.start()
  f.children[0].emit('error', Object.assign(Error(`private path ${token}`), { code: 'ENOENT' }))
  f.children[0].emit('close', -2)
  await until(() => f.tunnel.snapshot().state === 'error')
  assert.equal(f.tunnel.snapshot().error, 'MISSING_CLOUDFLARED')
  await pause(20); assert.equal(f.calls.length, 1)
  assert.equal(JSON.stringify(f.changes).includes(token), false)
})

test('stop cancels pending restarts and dispose permanently prevents start', async t => {
  const f = fixture(t, { restartDelayMs: 100 })
  await f.tunnel.start()
  const before = f.changes.length
  f.children[0].emit('close', 1)
  await until(() => f.changes.length > before)
  await f.tunnel.stop()
  await pause(120)
  assert.equal(f.calls.length, 1)
  assert.equal(f.tunnel.snapshot().state, 'stopped')
  await f.tunnel.dispose()
  await assert.rejects(f.tunnel.start(), { code: 'TUNNEL_DISPOSED' })
})

test('startup timeout terminates the owned child before starting a replacement', async t => {
  const f = fixture(t, { startupTimeoutMs: 20, autoClose: false })
  await f.tunnel.start()
  await until(() => f.children[0].kills.length > 0)
  assert.equal(f.children[0].kills[0], 'SIGTERM')
  await until(() => f.tunnel.snapshot().error === 'TUNNEL_STOP_FAILED')
  assert.equal(f.calls.length, 1)
  await assert.rejects(f.tunnel.start(), { code: 'TUNNEL_STOPPING' })
  await access(f.calls[0].settings.cwd)
  f.children[0].emit('close', 1)
  await until(() => f.calls.length === 2)
})

test('stop retains ownership until close and cleans temporary files', async t => {
  const f = fixture(t, { autoClose: false })
  await f.tunnel.start()
  const directory = f.calls[0].settings.cwd
  await f.tunnel.stop()
  assert.deepEqual(f.children[0].kills, ['SIGTERM', 'SIGKILL'])
  assert.equal(f.tunnel.snapshot().error, 'TUNNEL_STOP_FAILED')
  await assert.rejects(f.tunnel.start(), { code: 'TUNNEL_STOPPING' })
  await access(directory)
  f.children[0].emit('close', 0)
  await until(() => f.tunnel.snapshot().state === 'stopped')
  await assert.rejects(access(directory), { code: 'ENOENT' })
  assert.equal(f.calls.length, 1)
})

test('stop during asynchronous setup never launches a child', async t => {
  const f = fixture(t)
  await Promise.all([f.tunnel.start(), f.tunnel.stop()])
  assert.equal(f.calls.length, 0)
  assert.equal(f.tunnel.snapshot().state, 'stopped')
})

test('a synchronous stop from a status subscriber cannot leak setup directories', async () => {
  const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('ds-mobile-named-')))
  let tunnel, stopping, spawned = false
  tunnel = createNamedTunnel({ url, token,
    spawnImpl() { spawned = true; throw Error('must not launch') },
    onChange(value) { if (value.state === 'starting') stopping = tunnel.stop() } })
  await tunnel.start(); await stopping
  assert.equal(spawned, false)
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('ds-mobile-named-') && !before.has(name)), [])
  await tunnel.dispose()
})

test('invalid token input fails before a process can be launched', () => {
  for (const value of ['', 'short', `${token} `]) assert.throws(() => createNamedTunnel({ url, token: value }), { code: 'INVALID_TUNNEL_TOKEN' })
})

test('a local process receives the token through its environment and is reaped on stop', async t => {
  let child, directory, registered, failed
  const ready = new Promise((resolve, reject) => { registered = resolve; failed = reject })
  ready.catch(() => {})
  const tunnel = createNamedTunnel({ url, token, startupTimeoutMs: 5000,
    spawnImpl(command, args, settings) {
      assert.equal(command, 'cloudflared')
      assert.equal(args.includes(token), false)
      directory = settings.cwd
      child = spawn(process.execPath, ['--input-type=module', '-e',
        'if (!process.env.TUNNEL_TOKEN || process.argv.some(arg => arg.includes(process.env.TUNNEL_TOKEN))) process.exit(1); process.stderr.write("Registered tunnel connection connIndex=0\\n"); setInterval(() => {}, 1000)'], settings)
      return child
    }, onChange(value) { if (value.state === 'running') registered(); if (value.state === 'error') failed(Error(value.error)) } })
  t.after(() => tunnel.dispose())
  await tunnel.start(); await ready
  assert.equal(tunnel.snapshot().url, url)
  await tunnel.stop()
  assert.equal(tunnel.snapshot().state, 'stopped')
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
  await assert.rejects(access(directory), { code: 'ENOENT' })
})
