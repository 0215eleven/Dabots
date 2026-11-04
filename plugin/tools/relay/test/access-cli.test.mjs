import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAccess} from '../access.mjs';

const execute=promisify(execFile),cli=fileURLToPath(new URL('../access-cli.mjs',import.meta.url));
async function run(...args){
 try{const result=await execute(process.execPath,[cli,...args]);return {...result,code:0};}
 catch(error){return {stdout:error.stdout,stderr:error.stderr,code:error.code};}
}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'dabots-access-cli-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'access.json');}

test('offline init, issue, list and revoke; only explicit issue outputs invitation secrets',async t=>{
 const file=await fixture(t);
 let result=await run('init','--file',file);assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{initialized:true});
 result=await run('issue','--file',file,'--count','2','--expires-in-ms','60000');assert.equal(result.code,0,result.stderr);
 const invites=JSON.parse(result.stdout);assert.equal(invites.length,2);assert.match(invites[0].code,/^[A-Za-z0-9_-]{32}$/);
 assert.equal((await readFile(file,'utf8')).includes(invites[0].code),false);
 const phoneKey=randomBytes(32).toString('base64url'),access=await createAccess({file});
 const {phoneId}=await access.redeem(invites[0].code,phoneKey);await access.close();
 result=await run('list','--file',file);assert.equal(result.code,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).phones[0].id,phoneId);
 for(const secret of [phoneKey,...invites.map(i=>i.code)])assert.equal(result.stdout.includes(secret),false);
 result=await run('revoke','--file',file,'--phone',phoneId);assert.equal(result.code,0,result.stderr);
 const reopened=await createAccess({file});try{assert.equal(reopened.isPhone(phoneKey),false);}finally{await reopened.close();}
 const help=await run('--help');assert.equal(help.code,0);assert.match(help.stdout,/Stop the relay/);
});

test('missing and corrupt stores fail closed without initializing; malformed arguments and errors are redacted',async t=>{
 const file=await fixture(t),marker='sensitive-input-do-not-echo';
 for(const command of ['issue','list','revoke']){
  const result=await run(command,'--file',file,...(command==='revoke'?['--phone',marker]:[]));
  assert.equal(result.code,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'ACCESS_STORE_MISSING\n');
 }
 await assert.rejects(readFile(file),{code:'ENOENT'});
 await writeFile(file,JSON.stringify({version:1,admins:[marker],approved:[],pending:[],denied:[]}));
 let result=await run('init','--file',file);assert.equal(result.stderr,'INVALID_ACCESS_STORE\n');assert.equal(result.stdout,'');
 assert.equal((await readFile(file,'utf8')).includes(marker),true,'init must not overwrite an old store');
 for(const args of [['issue','--file',file,'--count',marker],['revoke','--file',file,'--phone',marker,'--unknown',marker],[marker],['list','--file',file,'--file',marker]]){
  result=await run(...args);assert.equal(result.code,1);assert.equal(result.stdout,'');assert.equal(result.stderr.includes(marker),false);assert.match(result.stderr,/USAGE/);
 }
 result=await run('list','--file',join(file,marker));assert.equal(result.code,1);assert.equal(result.stdout,'');assert.equal(result.stderr.includes(marker),false);assert.equal(result.stderr.includes(file),false);
});

test('the relay lifetime lock excludes a second CLI process; closed and stale locks are handled safely',async t=>{
 const file=await fixture(t),access=await createAccess({file,initialize:true});
 try{
  for(const command of ['init','issue','list','revoke']){
   const result=await run(command,'--file',file,...(command==='revoke'?['--phone','AAAAAAAAAAAAAAAAAAAAAA']:[]));
   assert.equal(result.code,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'ACCESS_LOCKED\n');
  }
  await assert.rejects(createAccess({file}),{code:'ACCESS_LOCKED'});
 }finally{await access.close();}
 assert.equal((await run('list','--file',file)).code,0);
 const stale='{"pid":2147483647,"token":"stale-fixture"}\n';await writeFile(file+'.lock',stale);
 const blocked=await run('issue','--file',file);assert.equal(blocked.code,1);assert.equal(blocked.stderr,'ACCESS_LOCKED\n');
 assert.equal(await readFile(file+'.lock','utf8'),stale,'never automatically remove a stale lock');
});
