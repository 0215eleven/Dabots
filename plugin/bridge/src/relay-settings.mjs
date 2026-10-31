import { readFile, writeFile, rename } from 'node:fs/promises'
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BridgeError } from './auth.js'
import { createRelayConnector } from './relay-client.mjs'

// The relay server: phones reach this Bridge through it after a scan, with no
// port, certificate or tunnel on this computer. Without saved settings a
// defaultRelay (from the plugin config) is used, so pairing is scan-and-go.
// Direct HTTPS/tunnel settings are untouched; selecting relay adds a door and
// switches the pairing code to the relay form. Neither the relay secret (optional
// for relays with open registration) nor key material ever leaves this module's files.
const refuse = (code, message) => { throw new BridgeError(400, code, message) }
const MODES = new Set(['direct', 'relay'])
async function writeAtomic(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, text, { mode: 0o600 })
  await rename(temporary, path)
}
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw Error('Saved relay settings are invalid; review the dedicated Bridge directory.') }
}
export function validateRelayUrl(value) {
  let parsed
  try { parsed = new URL(value) } catch { refuse('INVALID_RELAY_URL', '请输入完整的 wss:// 中转服务地址。') }
  if (typeof value !== 'string' || value.length > 2048 || parsed.protocol !== 'wss:' || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash || /[\s\\?#@]/u.test(value)) refuse('INVALID_RELAY_URL', '请输入不含账号、路径、查询或片段的 wss:// 中转服务地址。')
  return parsed.origin
}
const validSecret = value => typeof value === 'string' && Buffer.byteLength(value) >= 32 && value.length <= 512 && !/\s/.test(value)

// X25519 (NaCl box) and Ed25519 keys stay in the dedicated Bridge home.
async function loadIdentity(path) {
  let saved = await readJson(path)
  if (!saved) {
    const ed = generateKeyPairSync('ed25519'), x = generateKeyPairSync('x25519').privateKey.export({ format: 'jwk' })
    saved = { version: 1, ed: ed.privateKey.export({ format: 'pem', type: 'pkcs8' }), x: { publicKey: x.x, secretKey: x.d } }
    await writeAtomic(path, JSON.stringify(saved))
  }
  if (saved.version !== 1 || typeof saved.ed !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.x?.publicKey ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(saved.x?.secretKey ?? '')) throw Error('Saved relay identity is invalid.')
  const edPrivateKey = createPrivateKey(saved.ed)
  if (edPrivateKey.asymmetricKeyType !== 'ed25519') throw Error('Saved relay identity is invalid.')
  const derived = createPublicKey(createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', d: saved.x.secretKey, x: saved.x.publicKey }, format: 'jwk' })).export({ format: 'jwk' }).x
  if (derived !== saved.x.publicKey) throw Error('Saved relay identity is invalid.')
  return { edPrivateKey, xPublicKey: new Uint8Array(Buffer.from(saved.x.publicKey, 'base64url')), xSecretKey: new Uint8Array(Buffer.from(saved.x.secretKey, 'base64url')) }
}

export async function createRelaySettings({ home, server, Socket, connect = createRelayConnector, defaultRelay = null }) {
  const path = join(home, 'relay-connection.json'), identityPath = join(home, 'relay-identity.json')
  let settings = defaultRelay ? { version: 1, mode: 'relay', relay: validateRelayUrl(defaultRelay), secret: null } : { version: 1, mode: 'direct', relay: null, secret: null }
  // Until the owner saves a choice the relay is only the default: if it cannot be reached,
  // pairing falls back to the direct code instead of failing.
  let chosen = false
  const saved = await readJson(path)
  if (saved) {
    if (saved.version !== 1 || !MODES.has(saved.mode) || Object.keys(saved).some(key => !['version', 'mode', 'relay', 'secret'].includes(key))
      || (saved.relay !== null && validateRelayUrl(saved.relay) !== saved.relay) || (saved.secret !== null && !validSecret(saved.secret))) throw Error('Saved relay settings are invalid; review the dedicated Bridge directory.')
    settings = saved
    chosen = true
  }
  let connector = null, generationOwner = null, state = { state: 'disabled', computerId: null, computerKey: null }, disposed = false, busy = false, revision = 0
  const relayReady = () => state.state === 'ready' && Boolean(state.computerId && state.computerKey)
  const pairingStatus = () => {
    const mode = settings.mode === 'relay' && (chosen || relayReady() || !server.url) ? 'relay' : 'direct'
    return { mode, available: mode === 'relay' ? relayReady() : Boolean(server.url) }
  }
  const pairingContext = () => JSON.stringify([pairingStatus(), ...(relayReady() ? [state.computerId, state.computerKey] : [])])
  const snapshot = () => ({ mode: settings.mode, relay: settings.relay, secretSet: Boolean(settings.secret), state: state.state,
    computerId: state.computerId, ready: settings.mode === 'relay' && relayReady(), revision })
  async function stop() {
    const current = connector
    connector = null
    generationOwner = null
    current?.close()
    state = { ...state, state: 'disabled' }
  }
  async function start() {
    const identity = await loadIdentity(identityPath)
    if (disposed) return
    // The connector reports synchronously while it is being created.
    const owner = {}
    generationOwner = owner
    const current = connect({ relay: settings.relay, secret: settings.secret, identity, serverId: server.serverId, endpoint: id => server.relayEndpoint(id), ...(Socket ? { Socket } : {}),
      onStatus: value => {
        if (generationOwner !== owner) return
        const before = pairingContext()
        if (value.state !== state.state || value.computerId !== state.computerId || value.computerKey !== state.computerKey) revision++
        state = { state: value.state, computerId: value.computerId, computerKey: value.computerKey }
        // A QR represents one available transport and identity. A default
        // relay recovering or failing must revoke codes from its previous door.
        if (before !== pairingContext()) server.invalidatePairings()
      } })
    connector = current
  }
  async function change(next) {
    if (disposed) refuse('REMOTE_CLOSED', '插件已停止，请重新打开管理页面。')
    if (busy) refuse('REMOTE_BUSY', '连接设置正在更新，请稍后重试。')
    busy = true
    try {
      await stop()
      await writeAtomic(path, JSON.stringify(next))
      settings = next
      chosen = true
      revision++
      // A different door makes outstanding codes meaningless; existing devices stay paired.
      server.invalidatePairings()
      if (settings.mode === 'relay') await start()
      return snapshot()
    } finally { busy = false }
  }
  if (settings.mode === 'relay' && settings.relay) await start()
  return {
    snapshot,
    pairingStatus,
    async configure(payload) {
      if (!payload || typeof payload !== 'object' || Object.keys(payload).some(key => !['relay', 'secret'].includes(key))) refuse('INVALID_RELAY_SETTINGS', '请填写中转服务地址。')
      const relay = validateRelayUrl(payload.relay)
      if (payload.secret !== undefined && payload.secret !== '' && !validSecret(payload.secret)) refuse('INVALID_RELAY_SECRET', '注册密钥至少 32 字节，且不能包含空白字符。')
      // An empty secret is allowed: open relays need none. A saved one is kept for the same address.
      const secret = payload.secret === '' ? null : payload.secret ?? (relay === settings.relay ? settings.secret : null)
      return change({ ...settings, relay, secret })
    },
    async select(payload) {
      if (!payload || !MODES.has(payload.mode) || Object.keys(payload).some(key => key !== 'mode')) refuse('INVALID_CONNECTION_MODE', '请选择服务器中转或自己直连。')
      if (payload.mode === 'relay' && !settings.relay) refuse('RELAY_NOT_CONFIGURED', '请先保存中转服务地址。')
      return change({ ...settings, mode: payload.mode })
    },
    // Relay pairing material: no URL, only what the phone needs to reach and
    // authenticate this computer through the owner's relay.
    pairing() {
      if (settings.mode !== 'relay') return null
      if (pairingStatus().mode === 'direct') return null
      if (!relayReady()) throw new BridgeError(409, 'RELAY_NOT_READY', '中转连接尚未就绪，请检查网络和中转服务地址。')
      const created = server.createPairing()
      return { v: 2, relay: settings.relay, computerId: state.computerId, computerKey: state.computerKey, serverId: created.serverId, code: created.code, expiresAt: created.expiresAt }
    },
    async dispose() { disposed = true; await stop() },
  }
}
