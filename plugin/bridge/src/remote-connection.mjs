import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BridgeError } from './auth.js'

const modes = new Set(['existing', 'fixed', 'quick', 'named'])
const refuse = (code, message) => { throw new BridgeError(400, code, message) }
const cleanupBlock = home => join(home, 'remote-cleanup-required.json')
export async function assertRemoteCleanupSafe(home) {
  try { await readFile(cleanupBlock(home)) }
  catch (error) { if (error.code === 'ENOENT') return }
  refuse('REMOTE_CLEANUP_REQUIRED', '上次临时隧道未确认停止。请先确认 cloudflared 进程已退出，再移除专用 Bridge 目录中的 remote-cleanup-required.json 并重新启用插件。')
}
export function validateRemoteUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\//i.test(value)
    || /[\s\\?#@]/u.test(value)) refuse('INVALID_REMOTE_URL', '请输入不含账号、路径、查询或片段的完整 HTTPS 地址。')
  let parsed
  try { parsed = new URL(value) } catch { refuse('INVALID_REMOTE_URL', '请输入有效的 HTTPS 地址。') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/'
    || !parsed.hostname || !/^https:\/\/[^/]+\/?$/i.test(value)) refuse('INVALID_REMOTE_URL', '请输入不含账号、路径、查询或片段的完整 HTTPS 地址。')
  return parsed.origin
}

const validRemoteToken = value => typeof value === 'string' && value.length >= 40 && value.length <= 4096 && !/\s/.test(value)

// This file holds owner-selected public routing and the owner-entered
// Cloudflare tunnel token. The token is never returned by the Bridge API.
export async function createRemoteConnection({ home, config = {}, server, createTunnel = async options => {
  const { createQuickTunnel } = await import('./quick-tunnel.mjs')
  return createQuickTunnel(options)
}, createNamed = async options => {
  const { createNamedTunnel } = await import('./named-tunnel.mjs')
  return createNamedTunnel(options)
} }) {
  const path = join(home, 'remote-connection.json')
  let settings = { version: 1, mode: config.remoteMode ?? 'existing', existingUrl: server.url ?? null, fixedUrl: null, namedUrl: null, namedToken: null }
  if (!modes.has(settings.mode)) refuse('INVALID_REMOTE_MODE', '请选择已有 HTTPS、固定域名或临时隧道。')
  if (settings.mode === 'fixed') settings.fixedUrl = settings.existingUrl
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'))
    if (!saved || saved.version !== 1 || !modes.has(saved.mode)
      || Object.keys(saved).some(key => !['version', 'mode', 'existingUrl', 'fixedUrl', 'namedUrl', 'namedToken'].includes(key))) throw Error('Invalid saved settings')
    for (const key of ['existingUrl', 'fixedUrl', 'namedUrl']) if (saved[key] != null) validateRemoteUrl(saved[key])
    if (saved.namedToken != null && !validRemoteToken(saved.namedToken)) throw Error('Invalid saved settings')
    // Entries written before the supervised tunnel existed carry no named keys.
    settings = { ...settings, ...saved }
  } catch (error) { if (error.code !== 'ENOENT') throw Error('Remote connection settings are invalid; review the dedicated Bridge configuration.') }
  const address = server.address
  const loopbackUrl = !config.certPath && !config.keyPath && ['127.0.0.1', '::1'].includes(address?.address)
    ? `http://${address.address === '::1' ? '[::1]' : address.address}:${address.port}` : null
  // Cloudflare stores this origin outside the Bridge. A randomly allocated
  // listener would leave its route pointing at yesterday's port after reload.
  const namedAvailable = Boolean(loopbackUrl && Number.isInteger(config.port) && config.port > 0 && config.port === address.port)
  let disposed = false, mutation = false, generation = 0, revision = 0, tunnel, creating, disposal, acceptingTunnel = false
  let quick = { state: 'stopped', url: null, error: null }
  let named = { state: 'stopped', url: null, error: null }
  let namedTunnel, namedCreating
  const configuredUrl = () => settings.mode === 'fixed' ? settings.fixedUrl
    : settings.mode === 'existing' ? settings.existingUrl
      : settings.mode === 'named' ? settings.namedUrl : null
  const setUrl = value => {
    if (server.url !== value) { server.setPublicUrl(value); revision++ }
  }
  setUrl(settings.mode === 'quick' || settings.mode === 'named' ? null : configuredUrl())
  const ownState = () => settings.mode === 'quick' ? quick
    : settings.mode === 'named' ? named
      : { state: configuredUrl() ? 'configured' : 'unconfigured', error: null }
  const snapshot = () => ({ mode: settings.mode, ...ownState(),
    url: server.url, configuredUrl: configuredUrl(),
    configuredUrls: { existing: settings.existingUrl, fixed: settings.fixedUrl, named: settings.namedUrl },
    tokenSet: Boolean(settings.namedToken), loopbackUrl, quickAvailable: Boolean(loopbackUrl), namedAvailable, revision })
  const assertLive = () => { if (disposed) refuse('REMOTE_CLOSED', '插件已停止，请重新打开管理页面。') }
  async function disposeTunnel(target, kind = 'quick') {
    let failed = false
    try { await target.dispose(); failed = target.snapshot().state !== 'stopped' } catch { failed = true }
    if (failed) {
      const value = { state: 'error', url: null, error: 'REMOTE_STOP_FAILED' }
      if (kind === 'named') named = value
      else quick = value
      // Fail closed on a later reload: an unconfirmed child could otherwise
      // reach a new Bridge that reuses the same loopback port.
      try { await writeFile(cleanupBlock(home), JSON.stringify({ version: 1, reason: 'UNCONFIRMED_TUNNEL_STOP' }), { mode: 0o600 }) }
      catch { refuse('REMOTE_STOP_FAILED', '隧道未确认停止，且无法保存重新加载阻止标记。请确认 cloudflared 进程退出后再启用插件。') }
      refuse('REMOTE_STOP_FAILED', '隧道进程未确认停止，已阻止重新加载。请确认 cloudflared 进程退出后按说明恢复。')
    }
    quick = { state: 'stopped', url: null, error: null }
  }
  async function stopNamed() {
    setUrl(null)
    const target = namedTunnel ?? await (namedCreating ?? Promise.resolve(null)).catch(() => null)
    if (target) {
      await target.stop()
      if (target.snapshot().state !== 'stopped') refuse('REMOTE_STOP_FAILED', '隧道进程尚未确认停止，请检查电脑后重试。')
    }
    namedTunnel = null; namedCreating = null
    named = { state: 'stopped', url: null, error: null }
  }
  async function startNamed() {
    if (mutation) refuse('REMOTE_BUSY', '连接设置正在更新，请稍后重试。')
    if (!loopbackUrl) refuse('QUICK_LOOPBACK_REQUIRED', '插件托管的隧道只支持未配置直接 TLS 的 Bridge loopback 服务。')
    if (!namedAvailable) refuse('NAMED_FIXED_PORT_REQUIRED', '请先在 Bridge 插件配置中设置未占用的固定非零端口，重新启用 Bridge，再同步 Cloudflare 的 Service URL。')
    if (!settings.namedUrl) refuse('REMOTE_URL_REQUIRED', '请先填写固定 HTTPS 地址。')
    if (!settings.namedToken) refuse('REMOTE_TOKEN_REQUIRED', '请先填写 Cloudflare 隧道 Token。')
    mutation = true
    const issued = ++generation
    try {
      if (!namedTunnel) {
        namedCreating = Promise.resolve(createNamed({ url: settings.namedUrl, token: settings.namedToken, onChange(value) {
          if (disposed || settings.mode !== 'named') return
          named = { state: value.state, url: value.url, error: value.error }
          setUrl(value.state === 'running' ? settings.namedUrl : null)
        } }))
        const created = await namedCreating
        if (disposed || issued !== generation) { await created.dispose().catch(() => {}); return snapshot() }
        namedTunnel = created
      }
      if (issued !== generation) return snapshot()
      await namedTunnel.start()
      return snapshot()
    } finally { mutation = false }
  }
  async function stopTunnel() {
    acceptingTunnel = false
    generation++
    if (settings.mode === 'quick') { setUrl(null); quick = { state: tunnel ? 'stopping' : 'stopped', url: null, error: null } }
    if (namedTunnel || namedCreating) await stopNamed()
    if (tunnel) {
      await tunnel.stop()
      quick = { ...tunnel.snapshot(), url: null }
      if (quick.state !== 'stopped') refuse('REMOTE_STOP_FAILED', '隧道进程尚未确认停止，请检查电脑后重试。')
    }
  }
  // A supervised named tunnel belongs to the Bridge, so it comes back on every
  // start instead of depending on a separately installed cloudflared service.
  if (settings.mode === 'named' && loopbackUrl && settings.namedUrl && settings.namedToken) {
    if (namedAvailable) void startNamed().catch(() => {})
    else named = { state: 'error', url: null, error: 'NAMED_FIXED_PORT_REQUIRED' }
  }
  return {
    snapshot,
    async configure(payload) {
      assertLive()
      if (mutation) refuse('REMOTE_BUSY', '连接设置正在更新，请稍后重试。')
      if (!payload || !modes.has(payload.mode) || Object.keys(payload).some(key => !['mode', 'url', 'token'].includes(key))
        || (payload.mode === 'quick' && payload.url !== undefined)) refuse('INVALID_REMOTE_MODE', '请选择已有 HTTPS、固定域名或临时隧道。')
      const next = { ...settings, mode: payload.mode }
      if ((payload.mode === 'quick' || payload.mode === 'named') && !loopbackUrl) refuse('QUICK_LOOPBACK_REQUIRED', '插件托管的隧道只支持未配置直接 TLS 的 Bridge loopback 服务。')
      if (payload.mode === 'named' && !namedAvailable) refuse('NAMED_FIXED_PORT_REQUIRED', '请先在 Bridge 插件配置中设置未占用的固定非零端口，重新启用 Bridge，再同步 Cloudflare 的 Service URL。')
      const urlKey = payload.mode === 'fixed' ? 'fixedUrl' : payload.mode === 'named' ? 'namedUrl' : 'existingUrl'
      if (payload.url !== undefined) next[urlKey] = validateRemoteUrl(payload.url)
      if (payload.mode !== 'quick' && !next[urlKey]) refuse('REMOTE_URL_REQUIRED', '请先填写已有的 HTTPS 地址。')
      if (payload.token !== undefined) {
        if (!validRemoteToken(payload.token)) refuse('INVALID_TUNNEL_TOKEN', 'Cloudflare 隧道 Token 格式不正确，请从 Cloudflare 后台整段复制。')
        next.namedToken = payload.token
      }
      if (payload.mode === 'named' && !next.namedToken) refuse('REMOTE_TOKEN_REQUIRED', '请先填写 Cloudflare 隧道 Token。')
      // HTTP is only an existing explicit development fixture, never persisted by this UI.
      for (const key of ['existingUrl', 'fixedUrl', 'namedUrl']) if (next[key] != null) next[key] = validateRemoteUrl(next[key])
      mutation = true
      try {
        await stopTunnel()
        assertLive()
        const temporary = `${path}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
        await rename(temporary, path)
        assertLive()
        settings = next
        setUrl(settings.mode === 'quick' || settings.mode === 'named' ? null : configuredUrl())
        return snapshot()
      } finally { mutation = false }
    },
    async start(payload = {}) {
      assertLive()
      if (payload.confirmed !== true || Object.keys(payload).some(key => key !== 'confirmed')) refuse('EXPOSURE_CONFIRMATION_REQUIRED', '启动前必须明确确认将 Bridge 暴露到公网。')
      if (mutation) refuse('REMOTE_BUSY', '连接设置正在更新，请稍后重试。')
      if (settings.mode === 'named') return startNamed()
      if (settings.mode !== 'quick' || !loopbackUrl) refuse('QUICK_MODE_REQUIRED', '请先选择临时隧道模式。')
      mutation = true
      const issued = ++generation
      acceptingTunnel = true
      try {
        if (!tunnel) {
          creating = Promise.resolve(createTunnel({ origin: loopbackUrl, onChange(value) {
            if (disposed || !acceptingTunnel || settings.mode !== 'quick') return
            quick = { ...value }
            setUrl(value.state === 'running' ? value.url : null)
          } }))
          const created = await creating
          if (disposed || issued !== generation) { await disposeTunnel(created); return snapshot() }
          tunnel = created
        }
        if (issued !== generation) return snapshot()
        await tunnel.start({ confirmed: true })
        return snapshot()
      } finally { mutation = false }
    },
    async stop() { assertLive(); await stopTunnel(); return snapshot() },
    dispose() {
      if (disposal) return disposal
      disposed = true; acceptingTunnel = false; generation++
      if (settings.mode === 'quick' || settings.mode === 'named') setUrl(null)
      disposal = (async () => {
        const target = tunnel ?? await creating
        if (target) await disposeTunnel(target)
        const namedTarget = namedTunnel ?? await (namedCreating ?? Promise.resolve(null)).catch(() => null)
        if (namedTarget) await disposeTunnel(namedTarget, 'named')
      })()
      return disposal
    },
  }
}
