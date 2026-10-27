#!/usr/bin/env node
// DS Bot relay service. Configuration comes only from the environment; the
// registration secret is read from a file so it never appears in process lists.
//   RELAY_ORIGIN=wss://relay.example.com   public origin phones and computers use
//   RELAY_SECRET_FILE=/etc/ds-bot-relay/secret   file holding the registration secret (>= 32 bytes)
//   RELAY_HOST=127.0.0.1  RELAY_PORT=8790   local listener behind the TLS reverse proxy
//   RELAY_TRUST_PROXY=1   use the proxy's X-Real-IP for rate limits (set only behind a local proxy)
//   RELAY_TRUSTED_PROXY_IP=172.30.50.2   optional exact proxy IP; replaces legacy loopback trust
import {readFileSync} from 'node:fs'
import {createRelay} from './server.mjs'

const env=process.env
if(!env.RELAY_ORIGIN||!env.RELAY_SECRET_FILE){console.error('Set RELAY_ORIGIN and RELAY_SECRET_FILE.');process.exit(2)}
const secret=readFileSync(env.RELAY_SECRET_FILE,'utf8').trim()
const port=Number(env.RELAY_PORT??8790)
if(!Number.isInteger(port)||port<1||port>65535){console.error('RELAY_PORT must be 1-65535.');process.exit(2)}
const relay=await createRelay({secret,origin:env.RELAY_ORIGIN,host:env.RELAY_HOST??'127.0.0.1',port,trustProxy:env.RELAY_TRUST_PROXY==='1',trustedProxyIp:env.RELAY_TRUSTED_PROXY_IP})
// Logs carry no addresses, keys, stream IDs or payload sizes.
console.log(`ds-bot-relay listening on ${env.RELAY_HOST??'127.0.0.1'}:${port} for ${new URL(env.RELAY_ORIGIN).origin}`)
let stopping=false
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await relay.close();process.exit(0)})
