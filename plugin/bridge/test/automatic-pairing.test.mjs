import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createAuthStore } from '../src/auth.js'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'bridge-lease-'))
  let time = 1000
  const auth = await createAuthStore(home, { now: () => time })
  t.after(async () => { await auth.close(); await rm(home, { recursive: true, force: true }) })
  return { auth, tick: ms => { time += ms } }
}

test('owner QR automatically approves exactly one phone with existing token format and no Agent grant', async t => {
  const { auth } = await fixture(t)
  const qr = auth.createPairing(null, { automatic: true })
  assert.ok(qr.leaseId)
  assert.equal(qr.expiresAt, 121000)
  const claim = auth.beginPairing({ code: qr.code, deviceName: 'Unchanged phone' })
  assert.throws(() => auth.beginPairing({ code: qr.code, deviceName: 'Replay' }), { code: 'INVALID_PAIRING_CODE' })
  const sessions = await Promise.all(Array.from({ length: 8 }, () => auth.completePairing(claim.claimToken)))
  assert.ok(sessions[0].accessToken)
  assert.ok(sessions[0].refreshToken)
  assert.equal(new Set(sessions.map(s => s.deviceId)).size, 1)
  assert.equal(auth.devices().length, 1)
  assert.equal(auth.devices()[0].agents, false)
  assert.equal(auth.pairingStatus().state, 'paired')
  const refreshed = await auth.refresh(sessions[0].refreshToken)
  await auth.revoke(refreshed.deviceId)
  assert.throws(() => auth.verifyAccess(refreshed.accessToken), { code: 'UNAUTHORIZED' })
})

test('automatic approval belongs only to its QR; manual pending requests stay pending', async t => {
  const { auth } = await fixture(t)
  const manual = auth.createPairing('https://own.example')
  const old = auth.beginPairing({ code: manual.code, deviceName: 'Pending phone' })
  const fresh = auth.createPairing(null, { automatic: true })
  assert.deepEqual(await auth.completePairing(old.claimToken), { status: 'pending', requestId: old.requestId })
  const claim = auth.beginPairing({ code: fresh.code, deviceName: 'This QR only' })
  assert.ok((await auth.completePairing(claim.claimToken)).accessToken)
  assert.equal(auth.pending().length, 1)
})

test('cancel, regeneration, transport switch and two-minute expiry invalidate automatic claims', async t => {
  const { auth, tick } = await fixture(t)
  for (const action of [qr => auth.cancelPairing(qr.leaseId), () => auth.createPairing(null, { automatic: true }), () => auth.invalidatePairings(), () => tick(120000)]) {
    const qr = auth.createPairing(null, { automatic: true })
    const claim = auth.beginPairing({ code: qr.code, deviceName: 'Late phone' })
    action(qr)
    await assert.rejects(auth.completePairing(claim.claimToken), { code: 'PAIRING_NOT_FOUND' })
  }
  const first = auth.createPairing(null, { automatic: true })
  const second = auth.createPairing(null, { automatic: true })
  auth.cancelPairing(first.leaseId)
  assert.ok(auth.beginPairing({ code: second.code, deviceName: 'Current phone' }))
})

test('cancel before create tombstones owner lease; cancel during issuance revokes raced token', async t => {
  const { auth } = await fixture(t)
  const leaseId = randomUUID()
  auth.cancelPairing(leaseId)
  assert.throws(() => auth.createPairing(null, { automatic: true, leaseId }), { code: 'PAIRING_CANCELLED' })
  const qr = auth.createPairing(null, { automatic: true })
  const claim = auth.beginPairing({ code: qr.code, deviceName: 'Race' })
  const pending = auth.completePairing(claim.claimToken)
  auth.cancelPairing(qr.leaseId)
  await assert.rejects(pending, { code: 'PAIRING_NOT_FOUND' })
  assert.equal(auth.devices().filter(d => !d.revokedAt).length, 0)
})

test('saturated cancellation memory still revokes the active QR and denies reordered creation', async t => {
 const { auth } = await fixture(t)
 const qr = auth.createPairing(null, { automatic: true })
 for (let i = 0; i < 256; i++) auth.cancelPairing(randomUUID())
 auth.cancelPairing(qr.leaseId)
 assert.throws(() => auth.beginPairing({ code: qr.code, deviceName: 'Must fail' }), { code: 'INVALID_PAIRING_CODE' })
 const late = randomUUID()
 auth.cancelPairing(late)
 assert.throws(() => auth.createPairing(null, { automatic: true, leaseId: late }), { code: 'PAIRING_LIMIT' })
})
