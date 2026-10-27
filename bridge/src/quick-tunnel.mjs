import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'

const failure = code => Object.assign(new Error(code), { code })
const MAX_LINE = 8192
const quickUrl = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com\/?$/i
const MAX_READINESS = 4096

// Use native HTTP directly so shell proxy settings cannot redirect this local
// readiness check. No cookies, auth headers, redirects or external URLs.
function localReadiness(url, { signal }) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', signal }, response => {
      if (response.statusCode !== 200) { response.destroy(); resolve({ status: response.statusCode }); return }
      const chunks = []
      let size = 0
      response.on('data', bytes => {
        size += bytes.length
        if (size > MAX_READINESS) { response.destroy(); reject(failure('INVALID_READINESS')); return }
        chunks.push(bytes)
      })
      response.on('error', reject)
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: 200 })))
    })
    req.on('error', reject)
    req.end()
  })
}

async function hasReadyConnection(response) {
  if (response.status !== 200 || !response.body) return false
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_READINESS) { await reader.cancel(); return false }
      chunks.push(value)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return Number.isSafeInteger(body.readyConnections) && body.readyConnections > 0
  } finally { reader.releaseLock() }
}

// Never inherit named-tunnel credentials, ingress settings, proxy settings, or
// log-file destinations from the user's shell. HOME also belongs to this run.
function isolatedEnvironment(source, directory) {
  const result = {}
  for (const [key, value] of Object.entries(source)) {
    if (['PATH', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL'].includes(key.toUpperCase()) && typeof value === 'string') result[key] = value
  }
  return { ...result, HOME: directory, USERPROFILE: directory, APPDATA: directory, LOCALAPPDATA: directory, TEMP: directory, TMP: directory, TMPDIR: directory }
}

/** Owner-controlled Quick Tunnel. Creation is inert; no credentials are read.
 * A running state means cloudflared registered its connection, not that a phone
 * completed an end-to-end check. No output or subprocess errors are returned.
 */
export function createQuickTunnel({ origin, onChange = () => {}, spawnImpl = spawn, env = process.env, fetchImpl = localReadiness, startupTimeoutMs = 30000, stopTimeoutMs = 3000, readinessIntervalMs = 1500, readinessTimeoutMs = 1000 } = {}) {
  const match = typeof origin === 'string' && /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9]\d*)$/.exec(origin)
  if (!match || Number(match[1]) > 65535) throw failure('INVALID_TUNNEL_ORIGIN')
  let state = { state: 'stopped', url: null, error: null }, current = null, disposed = false
  const snapshot = () => ({ ...state })
  function emit(phase, url = null, error = null) {
    state = { state: phase, url, error }
    // A view subscriber cannot break process ownership or cleanup.
    try { onChange(snapshot()) } catch { /* Subscriber failures stay local. */ }
  }
  function clearTimers(run) {
    clearTimeout(run.startupTimer); clearTimeout(run.killTimer); clearTimeout(run.stopTimer)
    clearTimeout(run.readinessTimer); clearTimeout(run.probeTimer); run.probe?.abort()
  }
  async function finish(run) {
    if (run.finishing) return run.done
    run.finishing = true
    clearTimers(run)
    if (!run.stopping && !run.cause) run.cause = 'TUNNEL_EXITED'
    if (current === run) emit(run.cause ? 'error' : 'stopping', null, run.cause)
    for (const [stream, listener] of run.readers) stream.off('data', listener)
    try { if (run.directory) await rm(run.directory, { recursive: true, force: true }) }
    catch { run.cause ??= 'TUNNEL_CLEANUP_FAILED' }
    if (current === run) {
      current = null
      emit(run.cause ? 'error' : 'stopped', null, run.cause)
    }
    run.resolveDone(snapshot())
    return run.done
  }
  function terminate(run) {
    if (run.termination) return run.termination
    run.stopping = true
    clearTimeout(run.startupTimer)
    clearTimeout(run.readinessTimer); clearTimeout(run.probeTimer); run.probe?.abort()
    run.termination = (async () => {
      // A stop during mkdtemp/writeFile cancels before any child is spawned.
      await run.launch
      if (run.finishing) return run.done
      if (!run.child) return finish(run)
      const timedOut = new Promise(resolve => {
        run.killTimer = setTimeout(() => {
          if (run.finishing) return
          try { run.child.kill('SIGKILL') } catch { /* Wait for close or timeout. */ }
          run.stopTimer = setTimeout(() => {
            if (run.finishing) return
            // Keep ownership and the isolated files until close. A new launch
            // must not overlap a child whose termination is unconfirmed.
            run.cause = 'TUNNEL_STOP_FAILED'
            if (current === run) emit('error', null, run.cause)
            resolve(snapshot())
          }, stopTimeoutMs)
        }, stopTimeoutMs)
      })
      try { run.child.kill('SIGTERM') } catch { /* Escalation remains bounded. */ }
      return Promise.race([run.done, timedOut])
    })()
    return run.termination
  }
  function startTimeout(run) {
    clearTimeout(run.startupTimer)
    run.startupTimer = setTimeout(() => {
      if (current !== run || run.stopping || run.finishing) return
      run.cause = 'TUNNEL_START_TIMEOUT'
      emit('error', null, run.cause)
      void terminate(run)
    }, startupTimeoutMs)
  }
  function availability(run) {
    if (current !== run || run.stopping || run.finishing) return
    if (run.url && run.connections.size && run.ready) {
      clearTimeout(run.startupTimer)
      if (state.state !== 'running' || state.url !== run.url) emit('running', run.url)
    } else if (state.state === 'running') {
      emit('starting')
      startTimeout(run)
    }
  }
  async function probe(run) {
    if (current !== run || run.stopping || run.finishing) return
    const controller = new AbortController()
    run.probe = controller
    run.probeTimer = setTimeout(() => controller.abort(), readinessTimeoutMs)
    let ready = false
    try {
      const response = await fetchImpl(run.metricsUrl, { signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' })
      ready = await hasReadyConnection(response)
    } catch { /* A failed local probe never establishes availability. */ }
    finally { clearTimeout(run.probeTimer) }
    if (current !== run || run.stopping || run.finishing || run.probe !== controller) return
    run.ready = ready && !controller.signal.aborted
    availability(run)
    run.readinessTimer = setTimeout(() => { void probe(run) }, readinessIntervalMs)
  }
  function line(run, text) {
    if (current !== run || run.stopping || run.finishing) return
    // This exact literal listener is selected by our --metrics argument. Never
    // follow an arbitrary URL from subprocess output.
    const metrics = /\bStarting metrics server on 127\.0\.0\.1:([1-9]\d{0,4})\/metrics(?:\s|$)/.exec(text)
    if (!run.metricsUrl && metrics && Number(metrics[1]) <= 65535) {
      run.metricsUrl = `http://127.0.0.1:${metrics[1]}/ready`
      void probe(run)
    }
    const candidates = text.match(/\bhttps:\/\/[^\s|]+/g) ?? []
    for (const value of candidates) {
      if (!quickUrl.test(value)) continue
      const url = new URL(value).origin
      if (run.url && run.url !== url) {
        run.connections.clear()
        emit('starting')
        startTimeout(run)
      }
      run.url = url
    }
    const connection = /\bconnIndex=(\d+)\b/.exec(text)?.[1]
    if (/\bRegistered tunnel connection\b/.test(text)) run.connections.add(connection ?? '0')
    if (/\b(?:Unregistered tunnel connection|Connection terminated|Retrying connection in up to|Serve tunnel error)\b/.test(text)) {
      if (connection) run.connections.delete(connection)
      else run.connections.clear()
    }
    availability(run)
  }
  function read(run, stream) {
    let pending = '', discarded = false
    const listener = bytes => {
      if (current !== run || run.stopping || run.finishing) return
      const chunks = bytes.toString('utf8').split('\n')
      for (let index = 0; index < chunks.length; index++) {
        const part = chunks[index]
        if (!discarded) {
          if (pending.length + part.length > MAX_LINE) { pending = ''; discarded = true }
          else pending += part
        }
        if (index < chunks.length - 1) {
          if (!discarded) line(run, pending)
          pending = ''; discarded = false
        }
      }
    }
    stream.on('data', listener)
    run.readers.push([stream, listener])
  }
  async function start({ confirmed } = {}) {
    if (disposed) throw failure('TUNNEL_DISPOSED')
    if (confirmed !== true) throw failure('EXPOSURE_CONFIRMATION_REQUIRED')
    if (current) {
      if (current.stopping || current.finishing) throw failure('TUNNEL_STOPPING')
      await current.launch
      return snapshot()
    }
    const run = { child: null, directory: null, stopping: false, finishing: false, cause: null, url: null, connections: new Set(), ready: false, metricsUrl: null, readers: [] }
    run.done = new Promise(resolve => { run.resolveDone = resolve })
    current = run
    // Publish the launch promise before subscribers can synchronously stop.
    run.launch = Promise.resolve().then(async () => {
      try {
        run.directory = await mkdtemp(join(tmpdir(), 'ds-mobile-quick-'))
        const configPath = join(run.directory, 'config.yml')
        await writeFile(configPath, '{}\n', { mode: 0o600 })
        if (run.stopping || disposed) { await finish(run); return }
        run.child = spawnImpl('cloudflared', ['tunnel', '--config', configPath, '--no-autoupdate', '--metrics', '127.0.0.1:0', '--loglevel', 'info', '--url', origin], {
          shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: run.directory, env: isolatedEnvironment(env, run.directory),
        })
        run.child.once('close', () => {
          // A late close is positive termination evidence after the bounded
          // stop attempt timed out; do not keep claiming it is still alive.
          if (run.cause === 'TUNNEL_STOP_FAILED') run.cause = null
          void finish(run)
        })
        run.child.on('error', error => {
          if (run.finishing || current !== run) return
          run.cause = error.code === 'ENOENT' ? 'MISSING_CLOUDFLARED' : 'TUNNEL_PROCESS_ERROR'
          emit('error', null, run.cause)
          void terminate(run)
        })
        read(run, run.child.stdout); read(run, run.child.stderr)
        startTimeout(run)
      } catch (error) {
        run.cause = error.code === 'ENOENT' ? 'MISSING_CLOUDFLARED' : 'TUNNEL_START_FAILED'
        await finish(run)
      }
    })
    emit('starting')
    await run.launch
    return snapshot()
  }
  function stop() {
    const run = current
    if (!run) { emit('stopped'); return Promise.resolve(snapshot()) }
    if (!run.stopping) { run.cause = null; emit('stopping') }
    return terminate(run)
  }
  return {
    snapshot, start, stop,
    dispose() { disposed = true; return stop() },
  }
}
