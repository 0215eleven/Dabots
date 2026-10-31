#!/usr/bin/env node
// DS Bot relay service. Configuration comes only from the environment; the
// registration secret is read from a file so it never appears in process lists.
//   RELAY_ORIGIN=wss://relay.example.com   public origin phones and computers use
//   RELAY_SECRET_FILE=/etc/ds-bot-relay/secret   file holding the registration secret (>= 32 bytes)
//   RELAY_HOST=127.0.0.1  RELAY_PORT=8790   local listener behind the TLS reverse proxy
//   RELAY_TRUST_PROXY=1   use the proxy's X-Real-IP for rate limits (set only behind a local proxy)
//   RELAY_TRUSTED_PROXY_IP=172.30.50.2   optional exact proxy IP; replaces legacy loopback trust
//   RELAY_DATA_FILE=/var/lib/ds-bot-relay/accounts.json   optional; turns on accounts (owners and their computers)
//   RELAY_REGISTRATION=invite|open|closed   new accounts: by admin invite (default), anyone, or nobody.
//   The first account (the admin) registers with the one-time code the relay writes next to
//   RELAY_DATA_FILE as bootstrap-code (0600); the file is removed once the admin exists.
// With accounts, RELAY_SECRET_FILE is optional: computers may register with their owner's session instead.
//   RELAY_OPEN_REGISTRATION=1   any computer may register without a secret (scan-and-go, like a public relay).
//   RELAY_LIMITS_JSON={"maxComputers":100}   optional positive-integer quota overrides (see DEPLOYMENT.md)
//   RELAY_BLOCKED_IPS=198.51.100.1,2001:db8::1   exact literal IP deny list
//   RELAY_BLOCKED_COMPUTERS=<computerId>,...   signed-identity deny list
//   RELAY_DIAGNOSTICS=1   temporary redacted stdout events; 10 minutes / 200 lines maximum
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {createRelay} from './server.mjs'
import {createAccounts} from './accounts.mjs'

const env=process.env
let limits
try { limits=JSON.parse(env.RELAY_LIMITS_JSON??'{}') } catch { console.error('RELAY_LIMITS_JSON must be a JSON object of positive integer limits.');process.exit(2) }
const blockedIps=env.RELAY_BLOCKED_IPS?env.RELAY_BLOCKED_IPS.split(',').map(value=>value.trim()):[]
const blockedComputers=env.RELAY_BLOCKED_COMPUTERS?env.RELAY_BLOCKED_COMPUTERS.split(',').map(value=>value.trim()):[]
const openRegistration=env.RELAY_OPEN_REGISTRATION==='1'
if(!env.RELAY_ORIGIN||(!env.RELAY_SECRET_FILE&&!env.RELAY_DATA_FILE&&!openRegistration)){console.error('Set RELAY_ORIGIN and RELAY_SECRET_FILE (or RELAY_OPEN_REGISTRATION=1, or RELAY_DATA_FILE for accounts).');process.exit(2)}
const secret=env.RELAY_SECRET_FILE?readFileSync(env.RELAY_SECRET_FILE,'utf8').trim():undefined
const accounts=env.RELAY_DATA_FILE?await createAccounts({file:env.RELAY_DATA_FILE,bootstrapFile:join(dirname(env.RELAY_DATA_FILE),'bootstrap-code'),registration:env.RELAY_REGISTRATION??'invite'}):null
const port=Number(env.RELAY_PORT??8790)
if(!Number.isInteger(port)||port<1||port>65535){console.error('RELAY_PORT must be 1-65535.');process.exit(2)}
const relay=await createRelay({secret,origin:env.RELAY_ORIGIN,host:env.RELAY_HOST??'127.0.0.1',port,trustProxy:env.RELAY_TRUST_PROXY==='1',trustedProxyIp:env.RELAY_TRUSTED_PROXY_IP,accounts,openRegistration,limits,blockedIps,blockedComputers,diagnostics:env.RELAY_DIAGNOSTICS==='1'})
// Temporary diagnostics carry fixed labels and counters, never payloads or identities.
console.log(`ds-bot-relay listening on ${env.RELAY_HOST??'127.0.0.1'}:${port} for ${new URL(env.RELAY_ORIGIN).origin}${openRegistration?' with open registration':''}${accounts?` with accounts (${accounts.registration} registration)`:''}`)
let stopping=false
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await relay.close();process.exit(0)})
