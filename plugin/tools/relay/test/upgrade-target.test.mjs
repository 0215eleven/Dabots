import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createConnection } from 'node:net'

test('a malformed absolute upgrade target returns 400 without crashing the public relay', { timeout: 5000 }, async t => {
  // Keep the service in a subprocess so an uncaught request exception is itself
  // observable, rather than taking down this test runner and hiding the cause.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {createRelay} from ${JSON.stringify(new URL('../server.mjs', import.meta.url).href)};const relay=await createRelay({origin:'wss://fixture.example',openRegistration:true});console.log(relay.url)`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk })
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit') } })
  const [started] = await once(child.stdout, 'data'), url = started.toString().trim(), address = new URL(url)
  const socket = createConnection({ host: '127.0.0.1', port: Number(address.port) })
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  let response = ''; socket.on('data', chunk => { response += chunk })
  const closed = once(socket, 'close')
  socket.write('GET http://[ HTTP/1.1\r\nHost: fixture.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n')
  await closed
  assert.match(response, /^HTTP\/1\.1 400 /, errors)
  assert.equal((await fetch(url + '/healthz')).status, 200)
  assert.equal(child.exitCode, null)
})
