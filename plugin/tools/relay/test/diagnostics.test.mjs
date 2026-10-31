import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { generateKeyPairSync, createHash, sign } from 'node:crypto'
import WebSocket from 'ws'
import { createRelay } from '../server.mjs'

const origin = 'wss://diagnostic.example'
async function fixture(t, extra = {}) {
 const lines = []
 const relay = await createRelay({ origin, openRegistration: true, diagnostics: true, diagnosticLog: line => lines.push(line), ...extra })
 t.after(() => relay.close())
 return { ...relay, lines, entries: () => lines.map(line => JSON.parse(line)) }
}
async function computer(relay, wrong = false) {
 const socket = new WebSocket(relay.url + '/v1/computer'); socket.on('error', () => {})
 const [challenge] = await once(socket, 'message'), { nonce } = JSON.parse(challenge)
 const ed = generateKeyPairSync('ed25519'), x = generateKeyPairSync('x25519')
 const edBytes = ed.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
 const edPublicKey = edBytes.toString('base64url'), computerKey = x.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url')
 const computerId = createHash('sha256').update(edBytes).digest().subarray(0, 16).toString('base64url')
 const proof = JSON.stringify(['ds-bot-computer-v2', origin, nonce, computerId, edPublicKey, computerKey])
 const reply = wrong ? once(socket, 'close') : once(socket, 'message')
 const signature = sign(null, Buffer.from(wrong ? 'invalid-proof' : proof), ed.privateKey).toString('base64url')
 socket.send(JSON.stringify({ type: 'register', nonce, computerId, edPublicKey, computerKey, signature, secret: 'SENSITIVE_TEST_ONLY', name: 'SENSITIVE_TEST_ONLY' }))
 const result = await reply
 return { socket, computerId, privateValues: [nonce, computerId, edPublicKey, computerKey, signature], result }
}
async function refused(relay) {
 const socket = new WebSocket(relay.url + '/v1/phone?computer=SENSITIVE_TEST_ONLY', { headers: { 'x-real-ip': '198.51.100.222' } }); socket.on('error', () => {})
 const [, response] = await once(socket, 'unexpected-response'); response.resume(); socket.terminate()
 return response.statusCode
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('diagnostics default off and health has no new public data', async t => {
 const f = await fixture(t, { diagnostics: false })
 assert.equal(await refused(f), 409)
 assert.deepEqual(await (await fetch(f.url + '/healthz')).json(), { ok: true })
 assert.deepEqual(f.lines, [])
})

test('diagnostics trace public registration and phone close without payloads or persistent identities', async t => {
 const f = await fixture(t)
 const pc = await computer(f)
 const opened = once(pc.socket, 'message')
 const phone = new WebSocket(f.url + '/v1/phone?computer=' + pc.computerId); phone.on('error', () => {})
 await once(phone, 'message'); const [{ streamId }] = (await opened).map(data => JSON.parse(data))
 const received = once(pc.socket, 'message'); phone.send(Buffer.from('SENSITIVE_TEST_ONLY')); await received
 const returned = once(phone, 'message'); pc.socket.send(Buffer.concat([Buffer.from(streamId,'base64url'),Buffer.from('SENSITIVE_TEST_ONLY')])); await returned
 const closed = once(phone, 'close'); pc.socket.send(JSON.stringify({ type: 'close', streamId })); assert.equal((await closed)[0], 1000)
 const pcClosed = once(pc.socket, 'close'); pc.socket.close(1000, 'SENSITIVE_TEST_ONLY'); await pcClosed; await settle()
 const entries = f.entries()
 assert.ok(entries.some(e => e.event === 'computer_registered'))
 const linked = entries.find(e => e.event === 'phone_opened')
 assert.equal(typeof linked.computerConnection, 'number')
 const ending = entries.find(e => e.event === 'connection_closed' && e.role === 'phone')
 assert.equal(ending.closeCode, 1000)
 assert.equal(ending.inBytes, Buffer.byteLength('SENSITIVE_TEST_ONLY'))
 assert.equal(ending.inFrames, 1)
 assert.ok(entries.some(e => e.event === 'phone_first_frame' && e.binary === true))
 assert.equal(entries.filter(e => e.event === 'phone_ciphertext_forwarded').length, 1)
 assert.ok(entries.some(e => e.event === 'phone_closed_by_computer'))
 for (const value of [...pc.privateValues, streamId, 'SENSITIVE_TEST_ONLY', '198.51.100.222', origin, '/v1/phone']) assert.equal(f.lines.join('\n').includes(value), false)
 assert.ok(f.lines.every(line => Buffer.byteLength(line) <= 512))
})

test('diagnostics retain offline, stream quota and bad signature decisions as fixed codes', async t => {
 const f = await fixture(t, { limits: { streamsPerComputer: 1 } })
 assert.equal(await refused(f), 409)
 const bad = await computer(f, true); assert.equal(bad.result[0], 4403)
 const pc = await computer(f)
 const phone = new WebSocket(f.url + '/v1/phone?computer=' + pc.computerId); phone.on('error', () => {}); await once(phone, 'message')
 const extra = new WebSocket(f.url + '/v1/phone?computer=' + pc.computerId); extra.on('error', () => {})
 const [, response] = await once(extra, 'unexpected-response'); response.resume(); extra.terminate(); assert.equal(response.statusCode, 429)
 const entries = f.entries()
 assert.ok(entries.some(e => e.event === 'upgrade_rejected' && e.status === 409 && e.reason === 'COMPUTER_OFFLINE'))
 assert.ok(entries.some(e => e.event === 'upgrade_rejected' && e.status === 429 && e.reason === 'STREAM_LIMIT'))
 assert.ok(entries.some(e => e.event === 'registration_denied' && e.phase === 'signature'))
 phone.terminate(); pc.socket.terminate()
})

test('diagnostics stop after ten minutes and never resume from a clock rollback', async t => {
 let time = Date.now()
 const f = await fixture(t, { diagnosticNow: () => time })
 assert.equal(await refused(f), 409)
 time += 600001
 assert.equal(await refused(f), 409)
 const count = f.lines.length
 assert.equal(f.entries().at(-1).event, 'diagnostics_stopped')
 assert.equal(f.entries().at(-1).reason, 'TIME_LIMIT')
 time -= 600001
 assert.equal(await refused(f), 409)
 assert.equal(f.lines.length, count)
})

test('diagnostics have a hard 200-line budget independent of request traffic', async t => {
 const f = await fixture(t)
 for (let i = 0; i < 105; i++) await refused(f)
 assert.equal(f.lines.length, 200)
 assert.equal(f.entries().at(-1).event, 'diagnostics_stopped')
 assert.equal(f.entries().at(-1).reason, 'ENTRY_LIMIT')
 const count = f.lines.length; await refused(f); assert.equal(f.lines.length, count)
})

test('a failing diagnostic sink cannot take the relay down', async t => {
 let calls = 0
 const f = await fixture(t, { diagnosticLog: () => { calls++; throw Error('SENSITIVE_TEST_ONLY') } })
 assert.equal(await refused(f), 409)
 assert.equal((await fetch(f.url + '/healthz')).status, 200)
 assert.equal(calls, 1)
})

test('a rejected asynchronous diagnostic sink is observed and disables logging', async t => {
 let calls = 0
 const f = await fixture(t, { diagnosticLog: async () => { calls++; throw Error('SENSITIVE_TEST_ONLY') } })
 await settle()
 assert.equal(await refused(f), 409)
 assert.equal((await fetch(f.url + '/healthz')).status, 200)
 assert.equal(calls, 1)
})
