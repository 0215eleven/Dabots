import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export class BridgeError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const digest = value => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
const matches = (value, hash) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(hash ?? '')
  && timingSafeEqual(Buffer.from(digest(value)), Buffer.from(hash))

export async function createAuthStore(home, { now = Date.now, onRevoke = () => {}, onAgentsDenied = () => {} } = {}) {
  await mkdir(home, { recursive: true, mode: 0o700 })
  const path = join(home, 'bridge.json')
  let data
  try {
    data = JSON.parse(await readFile(path, 'utf8'))
    if (data.version !== 1 || typeof data.serverId !== 'string' || !Array.isArray(data.devices)
      || !data.submissions || !data.uploads || !data.readMarkers) throw new Error('Invalid mobile bridge state')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    data = { version: 1, serverId: randomUUID(), devices: [], submissions: {}, uploads: {}, readMarkers: {} }
  }
  let writes = Promise.resolve()
  function save() {
    const json = JSON.stringify(data)
    const write = async () => {
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, json, { mode: 0o600 })
      await rename(temporary, path)
    }
    const result = writes.then(write, write)
    writes = result.catch(() => {})
    return result
  }
  await save()
  const codes = new Map()
  const claims = new Map()
  const cancelled = new Map()
  let lease = null
  let cancellationBlock = 0
  const validLease = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(id)
  function invalidateLease(id) {
    for (const [key, item] of codes) if (item.leaseId === id) codes.delete(key)
    for (const [key, item] of claims) if (item.leaseId === id) {
      item.invalidated = true
      claims.delete(key)
    }
    if (lease?.leaseId === id) lease = null
  }
  function prunePairings() {
    for (const [id, item] of codes) if (item.expiresAt <= now()) codes.delete(id)
    for (const [id, item] of claims) if (item.expiresAt <= now()) claims.delete(id)
    for (const [id, expiry] of cancelled) if (expiry <= now()) cancelled.delete(id)
    if (lease?.expiresAt <= now()) invalidateLease(lease.leaseId)
  }
  // agents: the owner's per-device grant to use the team's DSH Agent. Missing means denied;
  // a re-paired phone is a new device and starts without it.
  const publicDevice = device => ({ id: device.id, name: device.name, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt ?? null, agents: device.agents === true })
  function verifyAccess(value) {
    const device = data.devices.find(item => !item.revokedAt && item.accessExpiresAt > now() && matches(value, item.accessHash))
    if (!device) throw new BridgeError(401, 'UNAUTHORIZED', 'Pair this device again or refresh its session.')
    return device
  }
  async function issueSession(device) {
    const accessToken = token()
    const refreshToken = token()
    Object.assign(device, { accessHash: digest(accessToken), refreshHash: digest(refreshToken), accessExpiresAt: now() + 15 * 60_000, refreshExpiresAt: now() + 30 * 86400_000, lastSeenAt: now() })
    await save()
    return { accessToken, refreshToken, deviceId: device.id, serverId: data.serverId, expiresAt: device.accessExpiresAt }
  }
  return {
    data,
    save,
    verifyAccess,
    devices: () => data.devices.map(publicDevice),
    invalidatePairings() {
      codes.clear()
      for (const claim of claims.values()) claim.invalidated = true
      claims.clear()
      lease = null
    },
    cancelPairing(leaseId) {
      prunePairings()
      if (!validLease(leaseId)) throw new BridgeError(400, 'INVALID_PAIRING_LEASE', 'A valid owner pairing lease is required.')
      invalidateLease(leaseId)
      // Cancellation must remain fail-closed even if owner requests exhaust
      // tombstone memory. Conservatively pause all creation until reordered
      // requests can no longer belong to this two-minute window.
      if (!cancelled.has(leaseId) && cancelled.size >= 256) cancellationBlock = now() + 120_000
      else cancelled.set(leaseId, now() + 120_000)
      return { cancelled: true }
    },
    pairingStatus() { prunePairings(); return lease ? { ...lease } : null },
    createPairing(url, { automatic = false, leaseId = randomUUID() } = {}) {
      prunePairings()
      if (cancellationBlock > now()) throw new BridgeError(429, 'PAIRING_LIMIT', 'Too many pairing operations. Try again shortly.')
      if (!validLease(leaseId)) throw new BridgeError(400, 'INVALID_PAIRING_LEASE', 'A valid owner pairing lease is required.')
      if (cancelled.has(leaseId)) throw new BridgeError(409, 'PAIRING_CANCELLED', 'This pairing window was closed.')
      if (lease) invalidateLease(lease.leaseId)
      codes.clear()
      const code = randomBytes(9).toString('base64url')
      const expiresAt = now() + 120_000
      codes.set(digest(code), { expiresAt, automatic, leaseId })
      lease = { leaseId, state: 'available', expiresAt }
      return { url, code, serverId: data.serverId, expiresAt, leaseId }
    },
    beginPairing({ code, deviceName }) {
      prunePairings()
      const key = typeof code === 'string' ? digest(code) : ''
      if (!codes.has(key)) throw new BridgeError(400, 'INVALID_PAIRING_CODE', 'The pairing code is invalid or has expired.')
      if (typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 100) throw new BridgeError(400, 'INVALID_DEVICE_NAME', 'Enter a device name of at most 100 characters.')
      if (claims.size >= 20) throw new BridgeError(429, 'PAIRING_LIMIT', 'Too many pending pairing requests.')
      const pairing = codes.get(key)
      codes.delete(key)
      const claimToken = token()
      const requestId = randomUUID()
      claims.set(requestId, { requestId, claimHash: digest(claimToken), deviceName: deviceName.trim(), status: pairing.automatic ? 'approved' : 'pending', createdAt: now(), expiresAt: pairing.automatic ? pairing.expiresAt : now() + 300_000, leaseId: pairing.automatic ? pairing.leaseId : null })
      if (lease?.leaseId === pairing.leaseId) lease.state = 'claimed'
      return { claimToken, requestId, status: 'pending' }
    },
    pending() {
      prunePairings()
      return [...claims.values()].filter(item => item.status === 'pending').map(({ requestId, deviceName, createdAt, expiresAt }) => ({ requestId, deviceName, createdAt, expiresAt }))
    },
    decidePairing(requestId, approve) {
      prunePairings()
      const claim = claims.get(requestId)
      if (!claim || claim.status !== 'pending') throw new BridgeError(404, 'PAIRING_NOT_FOUND', 'This pairing request is no longer pending.')
      claim.status = approve ? 'approved' : 'denied'
      return { requestId, status: claim.status }
    },
    async completePairing(claimToken) {
      prunePairings()
      const claim = [...claims.values()].find(item => matches(claimToken, item.claimHash))
      if (!claim) throw new BridgeError(404, 'PAIRING_NOT_FOUND', 'The pairing request has expired.')
      if (claim.status === 'pending') return { status: 'pending', requestId: claim.requestId }
      if (claim.status === 'denied') throw new BridgeError(403, 'PAIRING_DENIED', 'The computer declined this device.')
      if (claim.session) return claim.session
      if (claim.issuing) return claim.issuing
      if (data.devices.filter(item => !item.revokedAt).length >= 100) throw new BridgeError(409, 'DEVICE_LIMIT', 'Revoke an unused device before pairing another.')
      const device = { id: randomUUID(), name: claim.deviceName, createdAt: now(), lastSeenAt: now() }
      data.devices.push(device)
      claim.issuing = issueSession(device).then(async session => {
        if (claim.invalidated || claim.expiresAt <= now()) {
          device.revokedAt = now()
          delete device.accessHash
          delete device.refreshHash
          await save()
          throw new BridgeError(404, 'PAIRING_NOT_FOUND', 'The pairing address changed. Start pairing again.')
        }
        claim.session = session
        if (lease?.leaseId === claim.leaseId) lease.state = 'paired'
        claim.expiresAt = now() + 60_000
        return session
      })
      return claim.issuing
    },
    async refresh(refreshToken) {
      const device = data.devices.find(item => !item.revokedAt && item.refreshExpiresAt > now() && matches(refreshToken, item.refreshHash))
      if (!device) throw new BridgeError(401, 'UNAUTHORIZED', 'This session has expired or was revoked. Pair the device again.')
      return issueSession(device)
    },
    agentsAllowed: id => data.devices.some(device => device.id === id && !device.revokedAt && device.agents === true),
    async setAgents(id, enabled) {
      const device = data.devices.find(item => item.id === id && !item.revokedAt)
      if (!device) throw new BridgeError(404, 'DEVICE_NOT_FOUND', 'The device does not exist.')
      if (typeof enabled !== 'boolean') throw new BridgeError(400, 'INVALID_GRANT', 'enabled must be true or false.')
      if (enabled) device.agents = true
      else { delete device.agents; onAgentsDenied(id) }
      await save()
      return publicDevice(device)
    },
    async revoke(id) {
      const device = data.devices.find(item => item.id === id)
      if (!device) throw new BridgeError(404, 'DEVICE_NOT_FOUND', 'The device does not exist.')
      device.revokedAt = now()
      delete device.accessHash
      delete device.refreshHash
      onRevoke(id)
      await save()
      return { id, revoked: true }
    },
    async close() { await writes },
  }
}
