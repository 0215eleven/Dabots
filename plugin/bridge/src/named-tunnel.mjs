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
    clearTimeout(run.timer); clearTimeout(run.killTimer); clearTimeout(run.stopTimer)
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
  // A supervised tunnel replaces an external cloudflared service, so an unexpected
  // exit is retried a bounded number of times before the panel reports an error.
  function queueRestart(cause) {
    if (disposed) return
    if (['MISSING_CLOUDFLARED', 'INVALID_TUNNEL_TOKEN', 'TUNNEL_UNAUTHORIZED'].includes(cause) || restarts >= maxRestarts) {
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
  function terminate(run) {
    if (run.termination) return run.termination
    run.terminating = true
    clearTimeout(run.timer)
    run.termination = (async () => {
      await run.ready
      if (run.finished) return run.done
      if (!run.child) return finish(run)
      const timedOut = new Promise(resolve => {
        run.killTimer = setTimeout(() => {
          if (run.finished) return
          try { run.child.kill('SIGKILL') } catch { /* Wait for close or timeout. */ }
          run.stopTimer = setTimeout(() => {
            if (run.finished) return
            // Keep ownership and files until close; never overlap a live child.
            if (current === run) emit('error', null, 'TUNNEL_STOP_FAILED')
            resolve(snapshot())
          }, stopTimeoutMs)
        }, stopTimeoutMs)
      })
      try { run.child.kill('SIGTERM') } catch { /* Escalation remains bounded. */ }
      return Promise.race([run.done, timedOut])
    })()
    return run.termination
  }
  function read(run, stream) {
    let pending = ''
    const listener = bytes => {
      if (current !== run || run.stopping || run.terminating || run.finished) return
      pending += bytes.toString('utf8')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      if (pending.length > MAX_LINE) pending = ''
      for (const text of lines) {
        if (/\bRegistered tunnel connection\b/.test(text)) {
          restarts = 0
          clearTimeout(run.timer)
          if (!run.stopping) emit('running', url)
        }
        // Only inspect the error/message, never caller-controlled request fields.
        const detail = /\berror=(?:"([^"]*)"|(\S+))/.exec(text)
        const message = detail ? detail[1] ?? detail[2]
          : text.split(/\s+[\w.-]+=/, 1)[0].replace(/^(?:\S+\s+)?(?:ERR|WRN|INF)\s+/, '')
        if (/^(Unauthorized|Invalid tunnel secret|Invalid tunnel token|Provided Tunnel token is not valid)\b/i.test(message)) {
          run.cause = 'TUNNEL_UNAUTHORIZED'
          emit('error', null, run.cause)
          void terminate(run)
          break
        }
      }
    }
    stream.on('data', listener)
    run.readers.push([stream, listener])
  }
  function launch() {
    const run = { child: null, directory: null, stopping: false, finished: false, cause: null, readers: [] }
    run.done = new Promise(resolve => { run.resolveDone = resolve })
    current = run
    run.ready = Promise.resolve().then(async () => {
      try {
        run.directory = await mkdtemp(join(tmpdir(), 'ds-mobile-named-'))
        if (run.stopping || disposed) { await finish(run); return }
        run.child = spawnImpl('cloudflared', ['tunnel', '--no-autoupdate', '--loglevel', 'info', 'run'], {
          shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: run.directory,
          env: { ...isolatedEnvironment(env, run.directory), TUNNEL_TOKEN: token },
        })
        run.child.once('close', () => { void finish(run) })
        run.child.on('error', error => {
          if (run.finished || current !== run) return
          run.cause = error.code === 'ENOENT' ? 'MISSING_CLOUDFLARED' : 'TUNNEL_PROCESS_ERROR'
          if (error.code === 'ENOENT') void finish(run)
          else void terminate(run)
        })
        read(run, run.child.stdout)
        read(run, run.child.stderr)
        run.timer = setTimeout(() => {
          if (run.finished || run.stopping || current !== run) return
          run.cause = 'TUNNEL_START_TIMEOUT'
          emit('error', null, run.cause)
          void terminate(run)
        }, startupTimeoutMs)
      } catch (error) {
        run.cause = error.code === 'ENOENT' ? 'MISSING_CLOUDFLARED' : 'TUNNEL_START_FAILED'
        await finish(run)
      }
    })
    emit('starting')
    return run
  }
  async function start() {
    if (disposed) throw failure('TUNNEL_DISPOSED')
    if (current?.stopping || current?.terminating) throw failure('TUNNEL_STOPPING')
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
    return terminate(run)
  }
  return {
    snapshot, start, stop,
    dispose() { disposed = true; return stop() },
  }
}
