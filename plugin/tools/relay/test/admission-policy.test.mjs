import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,cp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAccess} from '../access.mjs';
const source=fileURLToPath(new URL('../',import.meta.url));
const keys=['RELAY_ACCESS_FILE','RELAY_SECRET_FILE','RELAY_DATA_FILE','RELAY_OPEN_REGISTRATION','RELAY_APPROVALS_FILE','RELAY_BUILD_KEY_FILE','RELAY_REGISTRATION'];
async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
test('the real service refuses changed admission or malformed installed policy before opening a listener',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-policy-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const file of ['bin.mjs','server.mjs','accounts.mjs','access.mjs','access-api.mjs','package.json'])await cp(join(source,file),join(dir,file));
 await symlink(join(source,'node_modules'),join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
 const file=join(dir,'access.json'),access=await createAccess({file,initialize:true});await access.close();
 await writeFile(join(dir,'secret'),'synthetic-local-policy-fixture-credential-0000');
 const selected=Object.fromEntries(keys.map(key=>[key,key==='RELAY_ACCESS_FILE'?file:'']));
 const policy={version:1,environment:selected};
 async function start(value,extra={}){
  await writeFile(join(dir,'admission-policy.json'),JSON.stringify(value));
  const child=spawn(process.execPath,[join(dir,'bin.mjs')],{env:{PATH:process.env.PATH,RELAY_ORIGIN:'wss://fixture.example',RELAY_ACCESS_FILE:file,RELAY_PORT:String(await freePort()),...extra},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const timer=setTimeout(()=>child.kill(),800);await once(child,'exit');clearTimeout(timer);return output;
 }
 const changed=await start(policy,{RELAY_ACCESS_FILE:'',RELAY_SECRET_FILE:join(dir,'secret')});
 assert.equal(changed.includes('listening'),false);assert.match(changed,/admission policy/i);
 for(const value of [null,false,0,[],{}, {version:1,environment:{...selected,unrecognized:'x'}}]){
  const malformed=await start(value);
  assert.equal(malformed.includes('listening'),false);assert.match(malformed,/admission policy/i);
 }
 const valid=await start(policy);assert.equal(valid.includes('with phone invitations'),true);
 assert.equal(valid.includes('synthetic-local-policy-fixture-credential'),false);
});
