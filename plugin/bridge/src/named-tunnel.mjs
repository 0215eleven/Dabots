import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const failure = code => Object.assign(new Error(code), { code })
const MAX_LINE = 8192

// Never inherit named-tunnel credentials, ingress settings, proxy settings or
// log destinations from the user's shell. HOME belongs to this run.
function isolatedEnvironment(source, directory) {
  const result = {}
  for (const [key, value] of Object.entries(source)) {
    if (['PATH', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL'].includes(key.toUpperCase()) && typeof value === 'string') result[key] = value
  }
  return { ...result, HOME: directory, USERPROFILE: directory, APPDATA: directory, LOCALAPPDATA: directory, TEMP: directory, TMP: directory, TMPDIR: directory }
}

/** Owner-supplied, remotely managed Cloudflare Tunnel that the Bridge runs and
 * supervises itself. The token is passed to the child only: no output, error or
 * snapshot ever contains it. A running state means cloudflared registered an
 * edge connection, not that the phone completed an end-to-end check.
 */
export function createNamedTunnel({ url, token, onChange = () => {}, spawnImpl = spawn, env = process.env, startupTimeoutMs = 45000, stopTimeoutMs = 4000, restartDelayMs = 3000, maxRestarts = 5 } = {}) {
  if (typeof url !== 'string' || !/^https:\/\/[^/]+$/i.test(url)) throw failure('INVALID_TUNNEL_URL')
  if (typeof token !== 'string' || token.length < 40 || token.length > 4096 || /\s/.test(token)) throw failure('INVALID_TUNNEL_TOKEN')
  let state = { state: 'stopped', url: null, error: null }, current = null, disposed = false, restarts = 0, restartTimer = null
  const snapshot = () => ({ ...state })
  function emit(phase, value = null, error = null) {
    state = { state: phase, url: value, error }
    // A view subscriber cannot break process ownership or cleanup.
    try { onChange(snapshot()) } catch { /* Subscriber failures stay local. */ }
  }
  async function finish(run) {
    if (run.finished) return run.done
    run.finished = true
    clearTimeout(run.timer)
    for (const [stream, listener] of run.readers) stream.off('data', listener)
    try { if (run.directory) await rm(run.directory, { recursive: true, force: true }) } catch { /* Cleanup stays bounded. */ }
    if (current === run) {
      current = null
      if (run.stopping || disposed) emit('stopped')
      else queueRestart(run.cause)
    }
    run.resolveDone(snapshot())
    return run.done
  }
  // A supervised tunnel replaces the外部 cloudflared service, so an unexpected
  // exit is retried a bounded number of times before the panel reports an error.
  function queueRestart(cause) {
    if (disposed) return
    if (cause === 'MISSING_CLOUDFLARED' || cause === 'INVALID_TUNNEL_TOKEN' || restarts >= maxRestarts) {
      emit('error', null, cause ?? 'TUNNEL_EXITED')
      return
    }
    restarts++
    emit('starting')
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (!disposed && !current) launch()
    }, restartDelayMs)
  }
  function read(run, stream) {
    let pending = ''
    const listener = bytes => {
      if (current !== run) return
      pending += bytes.toString('utf8')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      if (pending.length > MAX_LINE) pending = ''
      for (const text of lines) {
        if (/\bRegistered tunnel connection\b/.test(text)) {
          run.connected = true
          clearTimeout(run.timer)
          if (!run.stopping) emit('running', url)
        }
        if (/\b(Bad response|Invalid tunnel secret|failed to run tunnel|failed to connect to the edge)\b/i.test(text)) run.cause = 'TUNNEL_UNAUTHORIZED'
      }
    }
    stream.on('data', listener)
    run.readers.push([stream, listener])
  }
  function launch() {
    const run = { child: null, directory: null, stopping: false, finished: false, cause: null, connected: false, readers: [] }
    run.done = new Promise(resolve => { run.resolveDone = resolve })
    current = run
    emit('starting')
    run.ready = Promise.resolve().then(async () => {
      try {
        run.directory = await mkdtemp(join(tmpdir(), 'ds-mobile-named-'))
        if (run.stopping || disposed) { await finish(run); return }
        run.child = spawnImpl('cloudflared', ['tunnel', '--no-autoupdate', '--loglevel', 'info', 'run', '--token', token], {
          shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: run.directory, env: isolatedEnvironment(env, run.directory),
        })
        run.child.once('close', () => { void finish(run) })
        run.child.on('error', error => {
          if (run.finished || current !== run) return
          run.cause = error.code === 'ENOENT' ? 'MISSING_CLOUDFLARED' : 'TUNNEL_PROCESS_ERROR'
          void finish(run)
        })
        read(run, run.child.stdout)
        read(run, run.child.stderr)
        run.timer = setTimeout(() => {
          if (run.finished || run.stopping || current !== run) return
          run.cause = 'TUNNEL_START_TIMEOUT'
          void finish(run)
        }, startupTimeoutMs)
      } catch (error) {
        run.cause = error.code === 'ENOENT' ? 'MISSING_CLOUDFLARED' : 'TUNNEL_START_FAILED'
        await finish(run)
      }
    })
    return run
  }
  async function start() {
    if (disposed) throw failure('TUNNEL_DISPOSED')
    if (current) return snapshot()
    clearTimeout(restartTimer); restartTimer = null; restarts = 0
    const run = launch()
    await run.ready
    return snapshot()
  }
  async function stop() {
    clearTimeout(restartTimer); restartTimer = null
    restarts = maxRestarts
    const run = current
    if (!run) { emit('stopped'); return snapshot() }
    run.stopping = true
    clearTimeout(run.timer)
    emit('stopping')
    await run.ready
    if (run.child && !run.finished) {
      try { run.child.kill('SIGTERM') } catch { /* Escalation remains bounded. */ }
      const graceful = await Promise.race([run.done.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), stopTimeoutMs))])
      if (!graceful) {
        try { run.child.kill('SIGKILL') } catch { /* Waits for close below. */ }
        const forced = await Promise.race([run.done.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), stopTimeoutMs))])
        if (!forced) { emit('error', null, 'TUNNEL_STOP_FAILED'); return snapshot() }
      }
    }
    await run.done
    if (current === run) current = null
    emit('stopped')
    return snapshot()
  }
  return {
    snapshot, start, stop,
    dispose() { disposed = true; return stop() },
  }
}
