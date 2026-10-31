import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { generateKeyPairSync, createHash, sign } from 'node:crypto'
import WebSocket from 'ws'
import { createRelay } from '../server.mjs'

async function fixture(t, options = {}) {
 const origin = options.origin ?? 'wss://relay.example'
 const relay = await createRelay({ origin, openRegistration: true, ...options })
 t.after(() => relay.close())
 const socket = new WebSocket(relay.url + '/v1/computer'); socket.on('error', () => {})
 const [challenge] = await once(socket, 'message'); const { nonce } = JSON.parse(challenge)
 const ed = generateKeyPairSync('ed25519'), x = generateKeyPairSync('x25519')
 const edBytes = ed.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
 const edPublicKey = edBytes.toString('base64url'), computerKey = x.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url')
 const computerId = createHash('sha256').update(edBytes).digest().subarray(0, 16).toString('base64url')
 const registered = once(socket, 'message')
 socket.send(JSON.stringify({ type: 'register', nonce, computerId, edPublicKey, computerKey,
  signature: sign(null, Buffer.from(JSON.stringify(['ds-bot-computer-v2', origin, nonce, computerId, edPublicKey, computerKey])), ed.privateKey).toString('base64url') }))
 assert.equal(JSON.parse((await registered)[0]).type, 'registered')
 return { ...relay, computerId }
}
async function upgrade(relay, origin, path = '/v1/phone?computer=' + relay.computerId, headers = {}) {
 const socket = new WebSocket(relay.url.replace('http:', 'ws:') + path, { headers: { ...headers, ...(origin === undefined ? {} : { Origin: origin }) } }); socket.on('error', () => {})
 const result = await new Promise((resolve, reject) => {
  socket.once('message', bytes => resolve({ status: 101, type: JSON.parse(bytes).type }))
  socket.once('unexpected-response', (_req, response) => { response.resume(); resolve({ status: response.statusCode }) })
  socket.once('error', reject)
 })
 const closed = new Promise(resolve => socket.once('close', resolve)); socket.terminate(); await closed
 return result
}

test('SocketRocket HTTPS Origin for the configured WSS relay reaches the phone stream', async t => {
 const relay = await fixture(t)
 assert.deepEqual(await upgrade(relay, 'https://relay.example'), { status: 101, type: 'connected' })
 assert.deepEqual(await upgrade(relay, undefined), { status: 101, type: 'connected' })
})

test('native default Origin follows configured non-default ports and strips default WSS port', async t => {
 for (const [origin, header] of [['wss://relay.example:8443', 'https://relay.example:8443'], ['wss://relay.example:443', 'https://relay.example']]) {
  const relay = await fixture(t, { origin })
  assert.equal((await upgrade(relay, header)).status, 101)
 }
})

test('the native phone exception does not admit cross-site, opaque, malformed or spoofed origins', async t => {
 const relay = await fixture(t)
 for (const origin of ['https://evil.example', 'null', '', 'http://relay.example', 'wss://relay.example', 'https://relay.example.evil.example',
  'https://child.relay.example', 'https://relay.example:8443', 'https://relay.example/', 'https://relay.example?x=1',
  'https://user@relay.example', 'https://relay.example, https://evil.example', 'https://evil.example, https://relay.example']) {
  assert.equal((await upgrade(relay, origin)).status, 403, JSON.stringify(origin))
 }
 assert.equal((await upgrade(relay, 'https://evil.example', undefined, { Host: 'evil.example' })).status, 403)
 assert.equal((await upgrade(relay, ['https://relay.example', 'https://evil.example'])).status, 403)
})

test('the default phone exception never permits browser computer registration or unknown routes', async t => {
 const relay = await fixture(t)
 assert.equal((await upgrade(relay, 'https://relay.example', '/v1/computer')).status, 403)
 assert.equal((await upgrade(relay, 'https://relay.example', '/v1/phone-other')).status, 403)
})

test('explicit operator origins keep their existing authority instead of gaining an implicit native origin', async t => {
 const relay = await fixture(t, { allowedOrigins: ['https://trusted.example'] })
 assert.equal((await upgrade(relay, 'https://trusted.example')).status, 101)
 assert.equal((await upgrade(relay, 'https://relay.example')).status, 403)
 assert.equal((await upgrade(relay, 'https://evil.example')).status, 403)
})
