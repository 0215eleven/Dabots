import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {WebSocket} from 'ws'
import {createRelay} from '../server.mjs'

async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p}

test('the service reads its secret from a file, logs no secret and stops on SIGTERM',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'relay-bin-')),secret=randomBytes(32).toString('base64url'),port=await freePort()
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'secret'),secret+'\n',{mode:0o600})
  const child=spawn(process.execPath,[fileURLToPath(new URL('../bin.mjs',import.meta.url))],{env:{PATH:process.env.PATH,RELAY_ORIGIN:'wss://relay.example',RELAY_SECRET_FILE:join(dir,'secret'),RELAY_PORT:String(port),RELAY_TRUSTED_PROXY_IP:'127.0.0.1'},stdio:['ignore','pipe','pipe']})
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill()})
  let output='';child.stdout.on('data',c=>{output+=c});child.stderr.on('data',c=>{output+=c})
  for(let i=0;i<100&&!output.includes('listening');i++)await new Promise(r=>setTimeout(r,50))
  const health=await fetch(`http://127.0.0.1:${port}/healthz`)
  assert.deepEqual(await health.json(),{ok:true})
  const invalid=new WebSocket(`ws://127.0.0.1:${port}/v1/phone?computer=missing`,{headers:{'X-Real-IP':'invalid'}})
  invalid.on('error',()=>{})
  const [,response]=await once(invalid,'unexpected-response');response.resume();invalid.terminate();assert.equal(response.statusCode,400)
  child.kill('SIGTERM');const [code,signal]=await once(child,'exit')
  // Windows terminates the process rather than delivering POSIX SIGTERM.
  if(process.platform==='win32')assert.equal(signal,'SIGTERM');else assert.equal(code,0)
  assert.equal(output.includes(secret),false)
})

test('the proxy client address is used only when the peer is the local proxy',async t=>{
  for(const trustProxy of [false,true]){
    const relay=await createRelay({secret:randomBytes(32).toString('base64url'),origin:'wss://relay.example',trustProxy})
    t.after(()=>relay.close())
    const url=relay.url.replace('http:','ws:')+'/v1/phone?computer=missing'
    // 61 upgrades from "different" forwarded clients: only a trusted proxy spreads them over separate limits.
    let limited=0
    for(let i=0;i<61;i++){
      const ws=new WebSocket(url,{headers:{'x-real-ip':`198.51.100.${i}`}})
      const [,response]=await once(ws,'unexpected-response');limited+=response.statusCode===429?1:0;response.resume()
    }
    assert.equal(limited,trustProxy?0:1)
  }
})

test('invalid explicit proxy environment fails before listening',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'relay-proxy-env-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'secret'),randomBytes(32).toString('base64url'),{mode:0o600})
  const child=spawn(process.execPath,[fileURLToPath(new URL('../bin.mjs',import.meta.url))],{env:{PATH:process.env.PATH,RELAY_ORIGIN:'wss://relay.example',RELAY_SECRET_FILE:join(dir,'secret'),RELAY_TRUST_PROXY:'1',RELAY_TRUSTED_PROXY_IP:'127.0.0.0/8'},stdio:['ignore','pipe','pipe']})
  let output='';child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{output+=b})
  const [code]=await once(child,'exit');assert.equal(code,1);assert.equal(output.includes('listening'),false)
  assert.match(output,/trustedProxyIp must be one IP literal/)
})
