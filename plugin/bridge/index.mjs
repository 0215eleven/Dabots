import { isAbsolute, resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createAdapter } from './src/adapter.mjs'
import { createMobileServer } from './src/server.js'
import { validateConfig } from './src/config.mjs'
import { registerOwnerOperator } from './src/operator.mjs'
import { createRemoteConnection, assertRemoteCleanupSafe } from './src/remote-connection.mjs'
import { createRelaySettings } from './src/relay-settings.mjs'
import { BridgeError } from './src/auth.js'
export { Config } from './src/config.mjs'

export const name = 'ds-bot-mobile-bridge'
export const inject = ['connection', 'sessionController', 'webServer']
export function resolveBridgeHome(config = {}) {
  if (config.home) {
    if (!isAbsolute(config.home)) throw new Error('Bridge home must be absolute.')
    return resolve(config.home)
  }
  return join(resolveDshHome(), 'data', 'ds-bot-mobile-bridge')
}
export async function startBridge(ctx, config) {
  validateConfig(config)
  const home = resolveBridgeHome(config)
  if (home === resolveDshHome()) throw new Error('Bridge home must be separate from DSH_HOME.')
  await assertRemoteCleanupSafe(home)
  // Synthetic transcript mode is intentionally unavailable in the production entry.
  const adapter = createAdapter({ connection: ctx.connection, sessionController: ctx.sessionController })
  let server
  try {
    await adapter.initialize()
    server = await createMobileServer({ home, config, adapter, managedRemote: true })
    let officialSelected = false
    try { officialSelected = JSON.parse(await readFile(join(home, 'relay-selection.json'), 'utf8')).mode === 'official' }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const remote = await createRemoteConnection({ home, config, server, resumeNamed: !officialSelected })
    let relay
    try { relay = await createRelaySettings({ home, server, defaultRelay: config.relay || null }) } catch (error) { await remote.dispose(); throw error }
    let closing
    return { ...server, get url() { return server.url }, adapter,
      async operator(endpoint, payload = {}) {
        if (endpoint === 'status') return { ...await server.operator(endpoint), remote: remote.snapshot(), relay: relay.snapshot(), pairing: relay.pairingStatus() }
        if (endpoint === 'pairing.create') return relay.pairing(payload) ?? server.operator(endpoint, payload)
        if (endpoint === 'relay.official') { server.invalidatePairings(); await remote.stop(); return relay.official() }
        if (endpoint === 'relay.configure') return relay.configure(payload)
        if (endpoint === 'relay.select') return relay.select(payload)
        if (endpoint === 'remote.configure') { server.invalidatePairings(); return remote.configure(payload) }
        if (endpoint === 'remote.start') { server.invalidatePairings(); return remote.start(payload) }
        if (endpoint === 'remote.stop') { server.invalidatePairings(); return remote.stop() }
        return server.operator(endpoint, payload)
      },
      close() {
        if (!closing) closing = (async () => { try { await relay.dispose(); await remote.dispose() } finally { await server.close() } })()
        return closing
      },
    }
  } catch (error) {
    if (server) await server.close(); else await adapter.dispose()
    if (error.code === 'EADDRINUSE') throw new BridgeError(409, 'BRIDGE_PORT_IN_USE', 'Bridge 端口已被占用。请检查现有服务或在插件配置中选择未占用的固定端口，然后重新启用 Bridge；使用自有隧道时同时更新 Service URL。')
    throw error
  }
}
export function apply(ctx, config = {}) {
  validateConfig(config)
  ctx.effect(() => {
    let stopped = false
    let bridge
    let unregister
    let startupFailure
    let starting
    const initialize = () => starting ??= startBridge(ctx, config).then(async value => {
      if (stopped) { await value.close(); throw new BridgeError(409, 'REMOTE_CLOSED', '插件已停止。') }
      bridge = value
      startupFailure = null
      return value
    }).catch(error => {
      startupFailure = error instanceof BridgeError ? error : new BridgeError(503, 'BRIDGE_START_FAILED', '手机访问初始化失败，请重试或检查插件存储权限。')
      starting = null
      throw startupFailure
    })
    const register = () => registerOwnerOperator(ctx, '/mobile-operator', async (endpoint, payload, _signal, peer) => {
        // The Connection carrier authenticates the operator; explicitly fail
        // closed if a runtime does not provide its public owner principal.
        if (peer?.principal?.kind !== 'owner') return { ok: false, error: { code: 'OPERATOR_REQUIRED', message: 'An authenticated computer owner is required.', details: {} } }
        // Only an explicit owner choice may initialize first-use storage/listener.
        if (!bridge && (endpoint === 'relay.official' || endpoint === 'relay.select' && payload.mode === 'direct')) {
          try { await initialize() }
          catch (error) { return { ok: false, error: { code: error instanceof BridgeError ? error.code : 'BRIDGE_START_FAILED', message: error instanceof BridgeError ? error.message : '手机访问初始化失败，请重试或检查插件存储权限。', details: {} } } }
        }
        if (!bridge) return endpoint === 'status'
          ? { ok: true, value: { enabled: false, reason: startupFailure?.code ?? 'OFFICIAL_AVAILABLE', message: startupFailure?.message ?? '选择官方登录或隧道连接即可开始。' } }
          : { ok: false, error: { code: startupFailure?.code ?? 'CONFIGURATION_REQUIRED', message: startupFailure?.message ?? 'Configure and enable the mobile bridge first.', details: {} } }
        try { return { ok: true, value: await bridge.operator(endpoint, payload) } }
        catch (error) { return { ok: false, error: (endpoint.startsWith('remote.') || endpoint.startsWith('relay.') || endpoint === 'pairing.create') && error instanceof BridgeError
          ? { code: error.code, message: error.message, details: {} }
          : { code: 'OPERATOR_REFUSED', message: 'The operator request was refused.', details: {} } } }
      })
    const ready = (async () => {
      let resume = config.enabled === true
      if (!resume) {
        try {
          const saved = JSON.parse(await readFile(join(resolveBridgeHome(config), 'relay-selection.json'), 'utf8'))
          resume = saved.version === 1 && ['official', 'direct'].includes(saved.mode)
        } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      if (resume) await initialize()
    })().then(async () => {
      if (stopped) return bridge?.close()
      unregister = register()
    }).catch(async error => {
      await bridge?.close()
      if (!stopped) {
        startupFailure = error instanceof BridgeError ? error : new BridgeError(503, 'BRIDGE_START_FAILED', '手机访问初始化失败，请重试或检查插件存储权限。')
        unregister = register()
      }
      throw error
    })
    // Keep the rejection observed without printing URLs, pairing credentials or state.
    ready.catch(() => ctx.emit?.('internal/error', new Error(startupFailure?.message ?? 'Mobile bridge startup failed; verify dedicated config and team route readiness.')))
    return async () => { stopped = true; await ready.catch(() => {}); await starting?.catch(() => {}); await unregister?.(); await bridge?.close() }
  }, 'ds-bot-mobile-bridge')
}
