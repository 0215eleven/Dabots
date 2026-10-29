import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BridgeError } from './auth.js'

const modes = new Set(['existing', 'fixed', 'quick'])
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

// This file contains owner-selected public routing metadata only, never Cloudflare credentials.
export async function createRemoteConnection({ home, config = {}, server, createTunnel = async options => {
  const { createQuickTunnel } = await import('./quick-tunnel.mjs')
  return createQuickTunnel(options)
} }) {
  const path = join(home, 'remote-connection.json')
  let settings = { version: 1, mode: config.remoteMode ?? 'existing', existingUrl: server.url ?? null, fixedUrl: null }
  if (!modes.has(settings.mode)) refuse('INVALID_REMOTE_MODE', '请选择已有 HTTPS、固定域名或临时隧道。')
  if (settings.mode === 'fixed') settings.fixedUrl = settings.existingUrl
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'))
    if (!saved || saved.version !== 1 || !modes.has(saved.mode)
      || Object.keys(saved).some(key => !['version', 'mode', 'existingUrl', 'fixedUrl'].includes(key))) throw Error('Invalid saved settings')
    for (const key of ['existingUrl', 'fixedUrl']) if (saved[key] !== null) validateRemoteUrl(saved[key])
    settings = saved
  } catch (error) { if (error.code !== 'ENOENT') throw Error('Remote connection settings are invalid; review the dedicated Bridge configuration.') }
  const address = server.address
  const loopbackUrl = !config.certPath && !config.keyPath && ['127.0.0.1', '::1'].includes(address?.address)
    ? `http://${address.address === '::1' ? '[::1]' : address.address}:${address.port}` : null
  let disposed = false, mutation = false, generation = 0, revision = 0, tunnel, creating, disposal, acceptingTunnel = false
  let quick = { state: 'stopped', url: null, error: null }
  const configuredUrl = () => settings.mode === 'fixed' ? settings.fixedUrl : settings.mode === 'existing' ? settings.existingUrl : null
  const setUrl = value => {
    if (server.url !== value) { server.setPublicUrl(value); revision++ }
  }
  setUrl(settings.mode === 'quick' ? null : configuredUrl())
  const snapshot = () => ({ mode: settings.mode, ...(settings.mode === 'quick' ? quick : { state: configuredUrl() ? 'configured' : 'unconfigured', error: null }),
    url: server.url, configuredUrl: configuredUrl(), configuredUrls: { existing: settings.existingUrl, fixed: settings.fixedUrl }, loopbackUrl, quickAvailable: Boolean(loopbackUrl), revision })
  const assertLive = () => { if (disposed) refuse('REMOTE_CLOSED', '插件已停止，请重新打开管理页面。') }
  async function disposeTunnel(target) {
    let failed = false
    try { await target.dispose(); failed = target.snapshot().state !== 'stopped' } catch { failed = true }
    if (failed) {
      quick = { state: 'error', url: null, error: 'REMOTE_STOP_FAILED' }
      // Fail closed on a later reload: an unconfirmed child could otherwise
      // reach a new Bridge that reuses the same loopback port.
      try { await writeFile(cleanupBlock(home), JSON.stringify({ version: 1, reason: 'UNCONFIRMED_TUNNEL_STOP' }), { mode: 0o600 }) }
      catch { refuse('REMOTE_STOP_FAILED', '隧道未确认停止，且无法保存重新加载阻止标记。请确认 cloudflared 进程退出后再启用插件。') }
      refuse('REMOTE_STOP_FAILED', '隧道进程未确认停止，已阻止重新加载。请确认 cloudflared 进程退出后按说明恢复。')
    }
    quick = { state: 'stopped', url: null, error: null }
  }
  async function stopTunnel() {
    acceptingTunnel = false
    generation++
    if (settings.mode === 'quick') { setUrl(null); quick = { state: tunnel ? 'stopping' : 'stopped', url: null, error: null } }
    if (tunnel) {
      await tunnel.stop()
      quick = { ...tunnel.snapshot(), url: null }
      if (quick.state !== 'stopped') refuse('REMOTE_STOP_FAILED', '隧道进程尚未确认停止，请检查电脑后重试。')
    }
  }
  return {
    snapshot,
    async configure(payload) {
      assertLive()
      if (mutation) refuse('REMOTE_BUSY', '连接设置正在更新，请稍后重试。')
      if (!payload || !modes.has(payload.mode) || Object.keys(payload).some(key => !['mode', 'url'].includes(key))
        || (payload.mode === 'quick' && payload.url !== undefined)) refuse('INVALID_REMOTE_MODE', '请选择已有 HTTPS、固定域名或临时隧道。')
      const next = { ...settings, mode: payload.mode }
      if (payload.mode === 'quick' && !loopbackUrl) refuse('QUICK_LOOPBACK_REQUIRED', '临时隧道只支持未配置直接 TLS 的 Bridge loopback 服务。')
      if (payload.url !== undefined) next[payload.mode === 'fixed' ? 'fixedUrl' : 'existingUrl'] = validateRemoteUrl(payload.url)
      if (payload.mode !== 'quick' && !next[payload.mode === 'fixed' ? 'fixedUrl' : 'existingUrl']) refuse('REMOTE_URL_REQUIRED', '请先填写已有的 HTTPS 地址。')
      // HTTP is only an existing explicit development fixture, never persisted by this UI.
      for (const key of ['existingUrl', 'fixedUrl']) if (next[key] !== null) next[key] = validateRemoteUrl(next[key])
      mutation = true
      try {
        await stopTunnel()
        assertLive()
        const temporary = `${path}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
        await rename(temporary, path)
        assertLive()
        settings = next
        setUrl(settings.mode === 'quick' ? null : configuredUrl())
        return snapshot()
      } finally { mutation = false }
    },
    async start(payload = {}) {
      assertLive()
      if (settings.mode !== 'quick' || !loopbackUrl) refuse('QUICK_MODE_REQUIRED', '请先选择临时隧道模式。')
      if (payload.confirmed !== true || Object.keys(payload).some(key => key !== 'confirmed')) refuse('EXPOSURE_CONFIRMATION_REQUIRED', '启动前必须明确确认将 Bridge 暴露到公网。')
      if (mutation) refuse('REMOTE_BUSY', '连接设置正在更新，请稍后重试。')
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
      if (settings.mode === 'quick') setUrl(null)
      disposal = (async () => {
        const target = tunnel ?? await creating
        if (target) await disposeTunnel(target)
      })()
      return disposal
    },
  }
}
