import { isAbsolute, resolve } from 'node:path'
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
export async function startBridge(ctx, config) {
  validateConfig(config)
  if (!config?.home || !isAbsolute(config.home)) throw new Error('Set an absolute, dedicated bridge home; no DSH_HOME default is used.')
  const home = resolve(config.home)
  if (home === resolve(process.env.DSH_HOME ?? '/__unset__')) throw new Error('Bridge home must be separate from DSH_HOME.')
  await assertRemoteCleanupSafe(home)
  // Synthetic transcript mode is intentionally unavailable in the production entry.
  const adapter = createAdapter({ connection: ctx.connection, sessionController: ctx.sessionController })
  let server
  try {
    await adapter.initialize()
    server = await createMobileServer({ home, config, adapter, managedRemote: true })
    const remote = await createRemoteConnection({ home, config, server })
    let relay
    try { relay = await createRelaySettings({ home, server, defaultRelay: config.relay || null }) } catch (error) { await remote.dispose(); throw error }
    let closing
    return { ...server, get url() { return server.url }, adapter,
      async operator(endpoint, payload = {}) {
        if (endpoint === 'status') return { ...await server.operator(endpoint), remote: remote.snapshot(), relay: relay.snapshot(), pairing: relay.pairingStatus() }
        if (endpoint === 'pairing.create') return relay.pairing() ?? server.operator(endpoint, payload)
        if (endpoint === 'relay.configure') return relay.configure(payload)
        if (endpoint === 'relay.select') return relay.select(payload)
        if (endpoint === 'remote.configure') return remote.configure(payload)
        if (endpoint === 'remote.start') return remote.start(payload)
        if (endpoint === 'remote.stop') return remote.stop()
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
    const register = () => registerOwnerOperator(ctx, '/mobile-operator', async (endpoint, payload, _signal, peer) => {
        // The Connection carrier authenticates the operator; explicitly fail
        // closed if a runtime does not provide its public owner principal.
        if (peer?.principal?.kind !== 'owner') return { ok: false, error: { code: 'OPERATOR_REQUIRED', message: 'An authenticated computer owner is required.', details: {} } }
        if (!bridge) return endpoint === 'status'
          ? { ok: true, value: { enabled: false, reason: startupFailure?.code ?? 'CONFIGURATION_REQUIRED', message: startupFailure?.message ?? 'Set enabled, a dedicated absolute home, and HTTPS transport before pairing.' } }
          : { ok: false, error: { code: startupFailure?.code ?? 'CONFIGURATION_REQUIRED', message: startupFailure?.message ?? 'Configure and enable the mobile bridge first.', details: {} } }
        try { return { ok: true, value: await bridge.operator(endpoint, payload) } }
        catch (error) { return { ok: false, error: (endpoint.startsWith('remote.') || endpoint.startsWith('relay.') || endpoint === 'pairing.create') && error instanceof BridgeError
          ? { code: error.code, message: error.message, details: {} }
          : { code: 'OPERATOR_REFUSED', message: 'The operator request was refused.', details: {} } } }
      })
    const ready = (config.enabled === true ? startBridge(ctx, config) : Promise.resolve(null)).then(async value => {
      bridge = value
      if (stopped) return value?.close()
      unregister = register()
    }).catch(async error => {
      await bridge?.close()
      if (!stopped && error instanceof BridgeError && ['REMOTE_CLEANUP_REQUIRED', 'BRIDGE_PORT_IN_USE'].includes(error.code)) {
        startupFailure = error
        unregister = register()
      }
      throw error
    })
    // Keep the rejection observed without printing URLs, pairing credentials or state.
    ready.catch(() => ctx.emit?.('internal/error', new Error(startupFailure?.message ?? 'Mobile bridge startup failed; verify dedicated config and team route readiness.')))
    return async () => { stopped = true; await ready.catch(() => {}); await unregister?.(); await bridge?.close() }
  }, 'ds-bot-mobile-bridge')
}
