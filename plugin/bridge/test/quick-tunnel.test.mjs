import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFile, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const module = await import('../src/quick-tunnel.mjs').catch(() => ({}))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture(options = {}) {
  assert.equal(typeof module.createQuickTunnel, 'function', 'Quick Tunnel lifecycle must be implemented')
  const children = [], calls = [], changes = [], probes = []
  let ready = true
  const spawnImpl = (command, args, settings) => {
    calls.push({ command, args, settings })
    const child = new EventEmitter()
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), pid: 123, kills: [] })
    child.kill = signal => { child.kills.push(signal); if (options.autoClose !== false) queueMicrotask(() => child.emit('close', 0, signal)); return true }
    children.push(child)
    if (options.emitMetrics !== false) queueMicrotask(() => child.stderr.write('Starting metrics server on 127.0.0.1:41999/metrics\n'))
    return child
  }
  const fetchImpl = async (url, init) => {
    probes.push({ url: String(url), init })
    return new Response(JSON.stringify({ status: ready ? 200 : 503, readyConnections: ready ? 1 : 0, connectorId: 'fixture-connector' }), { status: ready ? 200 : 503 })
  }
  const tunnel = module.createQuickTunnel({ origin: 'http://127.0.0.1:43123', spawnImpl, fetchImpl, onChange: value => changes.push(value), startupTimeoutMs: 1000, stopTimeoutMs: 10, readinessIntervalMs: 5, readinessTimeoutMs: 15, ...options })
  return { tunnel, children, calls, changes, probes, setReady(value) { ready = value } }
}
async function connect(child, name = 'example-one') {
  child.stderr.write(`| https://${name}.trycloudflare.com |\n`)
  child.stderr.write('2026-01-01 INF Registered tunnel connection connIndex=0\n')
  await pause(1)
}

test('creation is inert, explicit confirmation is required and duplicate starts share one process', async t => {
  const f = fixture(); t.after(() => f.tunnel.dispose())
  assert.deepEqual(f.tunnel.snapshot(), { state: 'stopped', url: null, error: null })
  assert.equal(f.calls.length, 0)
  await assert.rejects(f.tunnel.start({ confirmed: false }), { code: 'EXPOSURE_CONFIRMATION_REQUIRED' })
  await assert.rejects(f.tunnel.start(), { code: 'EXPOSURE_CONFIRMATION_REQUIRED' })
  await Promise.all([f.tunnel.start({ confirmed: true }), f.tunnel.start({ confirmed: true })])
  assert.equal(f.calls.length, 1)
  await connect(f.children[0]); assert.equal(f.tunnel.snapshot().state, 'running')
  await f.tunnel.start({ confirmed: true }); assert.equal(f.calls.length, 1)
})

test('only the actual HTTP loopback listener can become the proxy origin', () => {
  assert.equal(typeof module.createQuickTunnel, 'function')
  for (const origin of ['https://127.0.0.1:443', 'http://0.0.0.0:8000', 'http://localhost:8000', 'http://127.0.0.1:0', 'http://127.0.0.1:80/path', 'http://user@127.0.0.1:8000', 'http://127.0.0.1:8000?admin=1', 'http://127.0.0.1:8000#part', 'http://[::]:8000', 'http://evil.example:8000']) {
    assert.throws(() => module.createQuickTunnel({ origin }), { code: 'INVALID_TUNNEL_ORIGIN' }, origin)
  }
})

test('spawn uses fixed arguments and isolated config/environment without shell or inherited tunnel credentials', async t => {
  const f = fixture({ env: { PATH: 'trusted-path', SystemRoot: 'C:\\Windows', TUNNEL_NAME: 'secret-name', TUNNEL_TOKEN: 'secret-token', HOME: 'private-home', CLOUDFLARED_CONFIG: 'private-config', HTTPS_PROXY: 'private-proxy' } })
  t.after(() => f.tunnel.dispose())
  await f.tunnel.start({ confirmed: true })
  const { command, args, settings } = f.calls[0]
  assert.equal(command, 'cloudflared')
  assert.deepEqual(args, ['tunnel', '--config', args[2], '--no-autoupdate', '--metrics', '127.0.0.1:0', '--loglevel', 'info', '--url', 'http://127.0.0.1:43123'])
  assert.equal(await readFile(args[2], 'utf8'), '{}\n')
  assert.equal(settings.shell, false); assert.equal(settings.windowsHide, true)
  assert.deepEqual(settings.stdio, ['ignore', 'pipe', 'pipe'])
  assert.equal(settings.env.PATH, 'trusted-path'); assert.equal(settings.env.SystemRoot, 'C:\\Windows')
  assert.equal(settings.env.TUNNEL_NAME, undefined); assert.equal(settings.env.TUNNEL_TOKEN, undefined)
  assert.equal(settings.env.HTTPS_PROXY, undefined); assert.equal(settings.env.CLOUDFLARED_CONFIG, undefined)
  assert.notEqual(settings.env.HOME, 'private-home'); assert.equal(settings.env.HOME, settings.cwd)
  await f.tunnel.stop(); await assert.rejects(access(args[2]))
})

test('URL and registration before readiness are not usable; both streams and chunked lines are supported', async t => {
  const f = fixture(); f.setReady(false); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true })
  f.children[0].stderr.write('| https://abc-'); f.children[0].stderr.write('123.trycloudflare.com |\n')
  assert.deepEqual(f.tunnel.snapshot(), { state: 'starting', url: null, error: null })
  f.children[0].stdout.write('Registered tunnel connec'); f.children[0].stdout.write('tion connIndex=0\n')
  await pause(10); assert.equal(f.tunnel.snapshot().url, null)
  f.setReady(true); await pause(15)
  assert.deepEqual(f.tunnel.snapshot(), { state: 'running', url: 'https://abc-123.trycloudflare.com', error: null })
})

test('malformed or deceptive URLs and unbounded log lines never become pairing addresses', async t => {
  const f = fixture(); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true })
  const child = f.children[0]
  child.stderr.write('Registered tunnel connection connIndex=0\n')
  for (const url of ['https://a.trycloudflare.com.evil', 'https://a.b.trycloudflare.com', 'https://user@a.trycloudflare.com', 'https://a.trycloudflare.com/path', 'https://a.trycloudflare.com?x=1', 'https://a.trycloudflare.com#x', 'https://a.trycloudflare.com:443', 'https://-a.trycloudflare.com']) {
    child.stderr.write(`${url}\n`); assert.equal(f.tunnel.snapshot().url, null, url)
  }
  child.stderr.write('x'.repeat(20000)); child.stderr.write(' https://discarded.trycloudflare.com\n')
  assert.equal(f.tunnel.snapshot().url, null)
  child.stderr.write('https://valid.trycloudflare.com\n'); await pause(1); assert.equal(f.tunnel.snapshot().url, 'https://valid.trycloudflare.com')
})

test('a new address immediately invalidates the old URL until a fresh connection event', async t => {
  const f = fixture(); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true }); await connect(f.children[0])
  f.children[0].stderr.write('https://changed.trycloudflare.com\n')
  assert.equal(f.tunnel.snapshot().state, 'starting'); assert.equal(f.tunnel.snapshot().url, null)
  f.children[0].stderr.write('Registered tunnel connection connIndex=0\n')
  assert.equal(f.tunnel.snapshot().url, 'https://changed.trycloudflare.com')
})

test('last-connection loss clears the usable address until a fresh registration without spawning again', async t => {
  const f = fixture(); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true })
  const child = f.children[0]
  for (const message of ['Unregistered tunnel connection', 'Connection terminated', 'Retrying connection in up to 1s', 'Serve tunnel error']) {
    await connect(child)
    child.stderr.write(`2026-01-01 ERR ${message} connIndex=0 error=private-error\n`)
    assert.deepEqual(f.tunnel.snapshot(), { state: 'starting', url: null, error: null }, message)
    child.stderr.write('Registered tunnel connection connIndex=0\n')
    assert.equal(f.tunnel.snapshot().url, 'https://example-one.trycloudflare.com')
  }
  assert.equal(f.calls.length, 1)
  assert.equal(JSON.stringify(f.changes).includes('private-error'), false)
})

test('a disconnect only retires its registered connection; missing index fails closed', async t => {
  const f = fixture(); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true })
  const child = f.children[0]; await connect(child)
  child.stderr.write('Registered tunnel connection connIndex=1\n')
  child.stderr.write('Connection terminated connIndex=0\n')
  assert.equal(f.tunnel.snapshot().state, 'running')
  child.stderr.write('Connection terminated\n')
  assert.equal(f.tunnel.snapshot().url, null)
})

test('readiness polls only the child-reported literal loopback port with no credentials or redirects', async t => {
  const f = fixture({ emitMetrics: false }); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true })
  const child = f.children[0]; await connect(child)
  for (const value of ['evil.example:443', '127.0.0.1:65536', '127.0.0.1:1234/metrics.evil', 'user@127.0.0.1:1234', '[::1]:1234']) {
    child.stderr.write(`Starting metrics server on ${value}/metrics\n`)
  }
  assert.equal(f.probes.length, 0); assert.equal(f.tunnel.snapshot().url, null)
  child.stderr.write('Starting metrics server on 127.0.0.1:41999/metrics\n'); await pause(5)
  assert.ok(f.probes.length > 0)
  for (const probe of f.probes) {
    assert.equal(probe.url, 'http://127.0.0.1:41999/ready')
    assert.equal(probe.init.redirect, 'error'); assert.equal(probe.init.credentials, 'omit')
    assert.equal(probe.init.headers, undefined)
  }
  assert.equal(f.tunnel.snapshot().state, 'running')
})

test('failed loopback readiness invalidates the address even without a disconnect log', async t => {
  const f = fixture(); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true }); await connect(f.children[0])
  assert.equal(f.tunnel.snapshot().state, 'running')
  f.setReady(false); await pause(25)
  assert.deepEqual(f.tunnel.snapshot(), { state: 'starting', url: null, error: null })
  f.setReady(true); await pause(25)
  assert.equal(f.tunnel.snapshot().state, 'running'); assert.equal(f.calls.length, 1)
})

test('invalid, oversized or failed readiness responses cannot establish a usable address', async t => {
  for (const fetchImpl of [async () => new Response('x'.repeat(10000)), async () => new Response('{"readyConnections":0}'), async () => new Response('{"readyConnections":1}', { status: 503 }), async () => { throw Error('secret failure') }]) {
    const f = fixture({ fetchImpl }); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true }); await connect(f.children[0])
    assert.equal(f.tunnel.snapshot().url, null)
    await f.tunnel.dispose()
  }
})

test('stopping aborts a readiness probe and late successful responses cannot restore the URL', async () => {
  let resolveProbe, probeSignal
  const f = fixture({ readinessTimeoutMs: 1000, fetchImpl: (_url, init) => { probeSignal = init.signal; return new Promise(resolve => { resolveProbe = resolve }) } })
  await f.tunnel.start({ confirmed: true }); await connect(f.children[0])
  await f.tunnel.stop(); assert.equal(probeSignal.aborted, true)
  resolveProbe(new Response('{"readyConnections":1}')); await pause(5)
  assert.equal(f.tunnel.snapshot().state, 'stopped'); assert.equal(f.tunnel.snapshot().url, null)
  await f.tunnel.dispose()
})

test('stop immediately invalidates URL, waits for close and blocks overlapping restart', async t => {
  const f = fixture({ autoClose: false, stopTimeoutMs: 1000 }); t.after(() => { for (const child of f.children) child.emit('close'); return f.tunnel.dispose() })
  await f.tunnel.start({ confirmed: true }); await connect(f.children[0])
  const stopped = f.tunnel.stop()
  assert.deepEqual(f.tunnel.snapshot(), { state: 'stopping', url: null, error: null })
  await assert.rejects(f.tunnel.start({ confirmed: true }), { code: 'TUNNEL_STOPPING' })
  f.children[0].stderr.write('https://late.trycloudflare.com\nRegistered tunnel connection\n')
  assert.equal(f.tunnel.snapshot().url, null)
  f.children[0].emit('close', 0); await stopped
  assert.equal(f.tunnel.snapshot().state, 'stopped')
  await f.tunnel.start({ confirmed: true }); await connect(f.children[1], 'second')
  f.children[0].emit('close', 1); f.children[0].stderr.write('https://old.trycloudflare.com\nRegistered tunnel connection\n')
  assert.equal(f.tunnel.snapshot().url, 'https://second.trycloudflare.com')
})

test('stop during asynchronous setup never launches a process', async () => {
  const f = fixture()
  const starting = f.tunnel.start({ confirmed: true }), stopping = f.tunnel.stop()
  await Promise.all([starting, stopping])
  assert.equal(f.calls.length, 0); assert.equal(f.tunnel.snapshot().state, 'stopped')
  await f.tunnel.dispose(); await assert.rejects(f.tunnel.start({ confirmed: true }), { code: 'TUNNEL_DISPOSED' })
})

test('missing executable and process failure expose safe errors, with explicit retry only', async t => {
  const f = fixture(); t.after(() => f.tunnel.dispose()); await f.tunnel.start({ confirmed: true })
  f.children[0].emit('error', Object.assign(Error('secret path and token'), { code: 'ENOENT' })); f.children[0].emit('close', -2)
  await pause(10)
  assert.deepEqual(f.tunnel.snapshot(), { state: 'error', url: null, error: 'MISSING_CLOUDFLARED' })
  assert.equal(f.calls.length, 1); assert.equal(JSON.stringify(f.changes).includes('secret'), false)
  await f.tunnel.start({ confirmed: true }); await connect(f.children[1]); f.children[1].emit('close', 1)
  await pause(10)
  assert.deepEqual(f.tunnel.snapshot(), { state: 'error', url: null, error: 'TUNNEL_EXITED' })
  assert.equal(f.calls.length, 2)
})

test('startup timeout kills the process and retry does not inherit stale output', async t => {
  const f = fixture({ startupTimeoutMs: 15 }); t.after(() => f.tunnel.dispose())
  await f.tunnel.start({ confirmed: true }); await pause(35)
  assert.equal(f.tunnel.snapshot().error, 'TUNNEL_START_TIMEOUT'); assert.equal(f.tunnel.snapshot().url, null)
  assert.deepEqual(f.children[0].kills, ['SIGTERM']); assert.equal(f.calls.length, 1)
  await f.tunnel.start({ confirmed: true }); await connect(f.children[1], 'retry')
  await connect(f.children[0], 'old'); assert.equal(f.tunnel.snapshot().url, 'https://retry.trycloudflare.com')
})

test('failed termination escalates once, retains ownership and prevents another process', async t => {
  const f = fixture({ autoClose: false }); t.after(async () => { f.children[0].emit('close'); await pause(5); await f.tunnel.dispose() })
  await f.tunnel.start({ confirmed: true }); await connect(f.children[0]); await f.tunnel.stop()
  assert.deepEqual(f.children[0].kills, ['SIGTERM', 'SIGKILL'])
  assert.deepEqual(f.tunnel.snapshot(), { state: 'error', url: null, error: 'TUNNEL_STOP_FAILED' })
  await assert.rejects(f.tunnel.start({ confirmed: true }), { code: 'TUNNEL_STOPPING' }); assert.equal(f.calls.length, 1)
  f.children[0].emit('close', 0)
  // Cleanup after the exit is asynchronous file work; wait for it instead of a fixed pause.
  for (let i = 0; i < 400 && f.tunnel.snapshot().state === 'stopping'; i++) await pause(5)
  assert.deepEqual(f.tunnel.snapshot(), { state: 'stopped', url: null, error: null })
})

test('dispose stops the child, clears URL and removes configuration without auto restart', async () => {
  const f = fixture(); await f.tunnel.start({ confirmed: true }); await connect(f.children[0])
  const path = f.calls[0].args[2]
  await f.tunnel.dispose()
  assert.equal(f.tunnel.snapshot().state, 'stopped'); assert.equal(f.tunnel.snapshot().url, null)
  await assert.rejects(access(path)); await assert.rejects(f.tunnel.start({ confirmed: true }), { code: 'TUNNEL_DISPOSED' })
  assert.equal(f.calls.length, 1)
})

test('a synchronous stop requested by a status subscriber does not leak setup files', async () => {
  const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('ds-mobile-quick-')))
  let tunnel, stopping, spawned = false
  tunnel = module.createQuickTunnel({ origin: 'http://127.0.0.1:43123', spawnImpl: () => { spawned = true; throw Error('must not spawn') }, onChange: value => { if (value.state === 'starting') stopping = tunnel.stop() } })
  await tunnel.start({ confirmed: true }); await stopping
  assert.equal(spawned, false)
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('ds-mobile-quick-') && !before.has(name)), [])
  await tunnel.dispose()
})

test('a local Node process fixture registers, terminates and leaves no owned configuration', async t => {
  let child, configPath, connected, failed
  const registered = new Promise((resolve, reject) => { connected = resolve; failed = reject })
  registered.catch(() => {})
  const tunnel = module.createQuickTunnel({
    origin: 'http://[::1]:43123', startupTimeoutMs: 5000,
    spawnImpl(command, args, options) {
      assert.equal(command, 'cloudflared'); assert.equal(args.at(-1), 'http://[::1]:43123')
      configPath = args[2]
      child = spawn(process.execPath, ['-e', 'const http=require("node:http"); const server=http.createServer((req,res)=>{if(req.url!=="/ready"){res.writeHead(404);res.end();return}res.end(JSON.stringify({status:200,readyConnections:1,connectorId:"fixture"}))});server.listen(0,"127.0.0.1",()=>process.stderr.write("Starting metrics server on 127.0.0.1:"+server.address().port+"/metrics\\nhttps://fixture.trycloudflare.com\\nRegistered tunnel connection connIndex=0\\n"))'], options)
      return child
    },
    onChange(value) { if (value.state === 'running') connected(); if (value.state === 'error') failed(Error(value.error)) },
  })
  t.after(() => tunnel.dispose())
  await tunnel.start({ confirmed: true }); await registered
  assert.equal(tunnel.snapshot().url, 'https://fixture.trycloudflare.com')
  await tunnel.dispose()
  assert.equal(tunnel.snapshot().state, 'stopped')
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
  await assert.rejects(access(configPath))
})
