#!/usr/bin/env node
// Official service: explicitly initialized RELAY_ACCESS_FILE, phone invitations only.
// Secret/account self-hosted service remains separate. Unsafe legacy official
// settings fail closed; never silently downgrade to public computer registration.
import {readFileSync,lstatSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createRelay} from './server.mjs';
import {createAccounts} from './accounts.mjs';
import {createAccess} from './access.mjs';
const env=process.env;
let relay,access;
try{
 // Updates install this immutable admission snapshot next to the entrypoint.
 // Validate the process's real environment, including absent/empty variables;
 // a changed env_file or unit drop-in cannot silently select a different mode.
 const policyFile=new URL('./admission-policy.json',import.meta.url);
 let policy,policyPresent=false;
 try{
  const info=lstatSync(policyFile);
  if(!info.isFile()||info.size>32768)throw Error();
  policy=JSON.parse(readFileSync(policyFile,'utf8'));policyPresent=true;
 }catch(error){if(error.code!=='ENOENT')throw Error('Installed admission policy is invalid.');}
 if(policyPresent){
  const keys=['RELAY_ACCESS_FILE','RELAY_SECRET_FILE','RELAY_DATA_FILE','RELAY_OPEN_REGISTRATION','RELAY_APPROVALS_FILE','RELAY_BUILD_KEY_FILE','RELAY_REGISTRATION'];
  if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).length!==2||policy.version!==1||!policy.environment||typeof policy.environment!=='object'||Array.isArray(policy.environment)||Object.keys(policy.environment).length!==keys.length||keys.some(key=>!Object.hasOwn(policy.environment,key)||typeof policy.environment[key]!=='string'||policy.environment[key].length>4096))throw Error('Installed admission policy is invalid.');
  if(keys.some(key=>(env[key]??'')!==policy.environment[key]))throw Error('Restart environment differs from the installed admission policy.');
 }
 if(env.RELAY_OPEN_REGISTRATION==='1'||env.RELAY_APPROVALS_FILE||env.RELAY_BUILD_KEY_FILE)throw Error('Legacy public/approval/build-key admission is disabled. Migrate explicitly to RELAY_ACCESS_FILE phone invitations.');
 if(!env.RELAY_ORIGIN||(!env.RELAY_SECRET_FILE&&!env.RELAY_DATA_FILE&&!env.RELAY_ACCESS_FILE))throw Error('Set RELAY_ORIGIN and RELAY_ACCESS_FILE for phone invitations, or a private self-hosted secret/account configuration.');
 if(env.RELAY_ACCESS_FILE&&(env.RELAY_SECRET_FILE||env.RELAY_DATA_FILE))throw Error('Phone invitations cannot mix with legacy secret/account admission.');
 let limits;try{limits=JSON.parse(env.RELAY_LIMITS_JSON??'{}');}catch{throw Error('RELAY_LIMITS_JSON must be a JSON object of positive integer limits.');}
 const port=Number(env.RELAY_PORT??8790);if(!Number.isInteger(port)||port<1||port>65535)throw Error('RELAY_PORT must be 1-65535.');
 access=env.RELAY_ACCESS_FILE?await createAccess({file:env.RELAY_ACCESS_FILE}):null;
 const secret=env.RELAY_SECRET_FILE?readFileSync(env.RELAY_SECRET_FILE,'utf8').trim():undefined;
 const accounts=env.RELAY_DATA_FILE?await createAccounts({file:env.RELAY_DATA_FILE,bootstrapFile:join(dirname(env.RELAY_DATA_FILE),'bootstrap-code'),registration:env.RELAY_REGISTRATION??'invite'}):null;
 relay=await createRelay({secret,origin:env.RELAY_ORIGIN,host:env.RELAY_HOST??'127.0.0.1',port,trustProxy:env.RELAY_TRUST_PROXY==='1',trustedProxyIp:env.RELAY_TRUSTED_PROXY_IP,accounts,access,limits,
  blockedIps:env.RELAY_BLOCKED_IPS?env.RELAY_BLOCKED_IPS.split(',').map(value=>value.trim()):[],
  blockedComputers:env.RELAY_BLOCKED_COMPUTERS?env.RELAY_BLOCKED_COMPUTERS.split(',').map(value=>value.trim()):[],diagnostics:env.RELAY_DIAGNOSTICS==='1'});
 console.log(`ds-bot-relay listening on ${env.RELAY_HOST??'127.0.0.1'}:${port} for ${new URL(env.RELAY_ORIGIN).origin}${access?' with phone invitations':''}${accounts?` with accounts (${accounts.registration} registration)`:''}`);
 let stopping=false;
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await relay.close();await access?.close();process.exit(0);});
}catch(error){await relay?.close();await access?.close();console.error(error.code??error.message);process.exitCode=2;}
