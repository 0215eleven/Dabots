import { readFile, writeFile, rename } from 'node:fs/promises'
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BridgeError } from './auth.js'
import { createRelayConnector } from './relay-client.mjs'

// The owner's own relay server: phones reach this Bridge through it after a scan.
// Direct HTTPS/tunnel settings are untouched; selecting relay adds a door and
// switches the pairing code to the relay form. Neither the relay secret nor key
// material ever leaves this module's files.
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

export async function createRelaySettings({ home, server, Socket, connect = createRelayConnector }) {
  const path = join(home, 'relay-connection.json'), identityPath = join(home, 'relay-identity.json')
  let settings = { version: 1, mode: 'direct', relay: null, secret: null }
  const saved = await readJson(path)
  if (saved) {
    if (saved.version !== 1 || !MODES.has(saved.mode) || Object.keys(saved).some(key => !['version', 'mode', 'relay', 'secret'].includes(key))
      || (saved.relay !== null && validateRelayUrl(saved.relay) !== saved.relay) || (saved.secret !== null && !validSecret(saved.secret))) throw Error('Saved relay settings are invalid; review the dedicated Bridge directory.')
    settings = saved
  }
  let connector = null, generationOwner = null, state = { state: 'disabled', computerId: null, computerKey: null }, disposed = false, busy = false, revision = 0
  const snapshot = () => ({ mode: settings.mode, relay: settings.relay, secretSet: Boolean(settings.secret), state: state.state,
    computerId: state.computerId, ready: settings.mode === 'relay' && state.state === 'ready', revision })
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
      onStatus: value => { if (generationOwner === owner) { if (value.state !== state.state) revision++; state = { state: value.state, computerId: value.computerId, computerKey: value.computerKey } } } })
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
      revision++
      // A different door makes outstanding codes meaningless; existing devices stay paired.
      server.invalidatePairings()
      if (settings.mode === 'relay') await start()
      return snapshot()
    } finally { busy = false }
  }
  if (settings.mode === 'relay' && settings.relay && settings.secret) await start()
  return {
    snapshot,
    async configure(payload) {
      if (!payload || typeof payload !== 'object' || Object.keys(payload).some(key => !['relay', 'secret'].includes(key))) refuse('INVALID_RELAY_SETTINGS', '请填写中转服务地址和注册密钥。')
      const relay = validateRelayUrl(payload.relay)
      if (payload.secret !== undefined && !validSecret(payload.secret)) refuse('INVALID_RELAY_SECRET', '注册密钥至少 32 字节，且不能包含空白字符。')
      const secret = payload.secret ?? (relay === settings.relay ? settings.secret : null)
      if (!secret) refuse('RELAY_SECRET_REQUIRED', '请填写中转服务的注册密钥。')
      return change({ ...settings, relay, secret })
    },
    async select(payload) {
      if (!payload || !MODES.has(payload.mode) || Object.keys(payload).some(key => key !== 'mode')) refuse('INVALID_CONNECTION_MODE', '请选择服务器中转或自己直连。')
      if (payload.mode === 'relay' && (!settings.relay || !settings.secret)) refuse('RELAY_NOT_CONFIGURED', '请先保存中转服务地址和注册密钥。')
      return change({ ...settings, mode: payload.mode })
    },
    // Relay pairing material: no URL, only what the phone needs to reach and
    // authenticate this computer through the owner's relay.
    pairing() {
      if (settings.mode !== 'relay') return null
      if (state.state !== 'ready' || !state.computerKey) throw new BridgeError(409, 'RELAY_NOT_READY', '中转连接尚未就绪，请检查中转服务地址、注册密钥和网络。')
      const created = server.createPairing()
      return { v: 2, relay: settings.relay, computerId: state.computerId, computerKey: state.computerKey, serverId: created.serverId, code: created.code, expiresAt: created.expiresAt }
    },
    async dispose() { disposed = true; await stop() },
  }
}
