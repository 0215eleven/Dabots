#!/usr/bin/env node
// Intentionally offline: the same lifetime lock is shared with the relay process.
import {createAccess} from './access.mjs';

const usage=`Usage:
  node access-cli.mjs init --file PATH
  node access-cli.mjs issue --file PATH [--count N] [--expires-in-ms N]
  node access-cli.mjs list --file PATH
  node access-cli.mjs revoke --file PATH --phone PHONE_ID

Stop the relay before using these commands; restart it afterward.
init explicitly creates a missing store. Existing valid stores are preserved.
issue defaults to one invitation expiring in 86400000 ms (24 hours).
Only issue prints secret invitation codes, as a JSON array. Store that output securely.
list and revoke use public record IDs and never print keys, hashes, or codes.
A lifetime .lock file prevents concurrent writers. A stale lock is never removed
automatically: verify that its process has exited before removing it manually.
`;
const knownErrors=new Set(['INVALID_FILE','ACCESS_IO','ACCESS_LOCKED','ACCESS_LOCK_RELEASE_FAILED','INVALID_ACCESS_STORE','ACCESS_STORE_MISSING','ACCESS_WRITE_FAILED','ACCESS_STORE_UNCERTAIN','ACCESS_CLOSED','INVALID_ISSUE','INVITE_LIMIT','INVALID_PHONE','PHONE_NOT_FOUND','USAGE']);
const invalid=()=>{throw Object.assign(new Error('USAGE'),{code:'USAGE'});};
function parse(args){
 const [command,...rest]=args;
 if(!['init','issue','list','revoke'].includes(command))invalid();
 const allowed=new Set(['--file',...(command==='issue'?['--count','--expires-in-ms']:[]),...(command==='revoke'?['--phone']:[])]),values={};
 for(let i=0;i<rest.length;i+=2){const option=rest[i],value=rest[i+1];if(!allowed.has(option)||Object.hasOwn(values,option)||typeof value!=='string'||!value||value.startsWith('--'))invalid();values[option]=value;}
 if(!values['--file']||(command==='revoke'&&!values['--phone']))invalid();
 for(const name of ['--count','--expires-in-ms'])if(values[name]!==undefined&&(!/^[1-9][0-9]*$/.test(values[name])||!Number.isSafeInteger(Number(values[name]))))invalid();
 return {command,values};
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length===1&&['--help','-h'].includes(args[0])){process.stdout.write(usage);return;}
 const {command,values}=parse(args);
 const access=await createAccess({file:values['--file'],initialize:command==='init'});
 let result;
 try{
  if(command==='init')result={initialized:true};
  if(command==='issue')result=await access.issue({count:values['--count']===undefined?1:Number(values['--count']),expiresInMs:values['--expires-in-ms']===undefined?86400000:Number(values['--expires-in-ms'])});
  if(command==='list')result=access.list();
  if(command==='revoke')result=await access.revokePhone(values['--phone']);
 }finally{await access.close();}
 process.stdout.write(JSON.stringify(result)+'\n');
}
main().catch(error=>{
 const code=knownErrors.has(error?.code)?error.code:'ACCESS_IO';
 process.stderr.write(code+(code==='USAGE'?' (use --help)':'')+'\n');process.exitCode=1;
});
