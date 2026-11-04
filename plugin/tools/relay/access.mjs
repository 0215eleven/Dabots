// Offline, single-writer phone enrollment store. The relay holds this lock for its lifetime.
import {createHash,randomBytes} from 'node:crypto';
import {open,readFile,rename,rm,realpath,lstat} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';

const fail=(status,code)=>Object.assign(new Error(code),{status,code});
const encoded=(value,size)=>typeof value==='string'&&value.length===Math.ceil(size*4/3)&&/^[A-Za-z0-9_-]+$/.test(value)&&Buffer.from(value,'base64url').length===size&&Buffer.from(value,'base64url').toString('base64url')===value;
const digest=value=>createHash('sha256').update(value).digest('base64url');
const phoneId=key=>createHash('sha256').update(Buffer.from(key,'base64url')).digest().subarray(0,16).toString('base64url');
const validServer=value=>typeof value==='string'&&value.length>=1&&value.length<=128&&!/[\u0000-\u001f\u007f]/.test(value);
const timestamp=value=>Number.isSafeInteger(value)&&value>=0;
const shape=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function validate(data){
 const invalid=()=>{throw fail(500,'INVALID_ACCESS_STORE');};
 if(!shape(data,['version','kind','invites','phones','computers'])||data.version!==1||data.kind!=='dabots-phone-access'||!['invites','phones','computers'].every(k=>Array.isArray(data[k])&&data[k].length<=4096))invalid();
 const phones=new Map(),invites=new Set(),hashes=new Set(),enrollments=new Set(),computers=new Set();
 for(const p of data.phones){
  if(!shape(p,['id','key','enrolledAt','revokedAt'])||!encoded(p.key,32)||!encoded(p.id,16)||p.id!==phoneId(p.key)||phones.has(p.id)||!timestamp(p.enrolledAt)||(p.revokedAt!==null&&(!timestamp(p.revokedAt)||p.revokedAt<p.enrolledAt)))invalid();
  phones.set(p.id,p);
 }
 for(const i of data.invites){
  if(!shape(i,['id','hash','createdAt','expiresAt','phoneId','redeemedAt'])||!encoded(i.id,16)||!encoded(i.hash,32)||invites.has(i.id)||hashes.has(i.hash)||!timestamp(i.createdAt)||!timestamp(i.expiresAt)||i.expiresAt<=i.createdAt)invalid();
  invites.add(i.id);hashes.add(i.hash);
  if(i.phoneId===null){if(i.redeemedAt!==null)invalid();}
  else{
   if(!encoded(i.phoneId,16)||!phones.has(i.phoneId)||enrollments.has(i.phoneId)||!timestamp(i.redeemedAt)||i.redeemedAt<i.createdAt||i.redeemedAt>=i.expiresAt||phones.get(i.phoneId).enrolledAt!==i.redeemedAt)invalid();
   enrollments.add(i.phoneId);
  }
 }
 if(enrollments.size!==phones.size)invalid();
 for(const c of data.computers){
  if(!shape(c,['id','phoneId','computerKey','serverId','associatedAt'])||!encoded(c.id,16)||computers.has(c.id)||!encoded(c.phoneId,16)||!phones.has(c.phoneId)||!encoded(c.computerKey,32)||!validServer(c.serverId)||!timestamp(c.associatedAt)||c.associatedAt<phones.get(c.phoneId).enrolledAt)invalid();
  computers.add(c.id);
 }
}

export async function createAccess({file,initialize=false,now=Date.now}){
 if(typeof file!=='string'||!file)throw fail(400,'INVALID_FILE');
 file=join(await realpath(dirname(resolve(file))),basename(file));
 const lockFile=file+'.lock',token=randomBytes(24).toString('base64url');
 let lock,poisoned=false;
 try{lock=await open(lockFile,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw fail(409,'ACCESS_LOCKED');throw fail(500,'ACCESS_IO');}
 async function unlock(){
  await lock.close();
  try{const saved=JSON.parse(await readFile(lockFile,'utf8'));if(saved.token===token)await rm(lockFile);}
  catch(error){if(error.code!=='ENOENT')throw fail(500,'ACCESS_LOCK_RELEASE_FAILED');}
 }
 async function save(candidate){
  const temporary=file+'.'+process.pid+'.'+randomBytes(12).toString('hex')+'.tmp';
  let handle,directory,replaced=false;
  try{
   handle=await open(temporary,'wx',0o600);
   await handle.writeFile(JSON.stringify(candidate)+'\n');await handle.sync();await handle.close();handle=null;
   await rename(temporary,file);
   replaced=true;
   // POSIX needs the containing directory synced to persist the renamed entry.
   // Node cannot open/sync directory handles on Windows; its power-loss durability
   // remains unverified. Do not silently ignore fsync failures on supported platforms.
   if(process.platform!=='win32'){
    directory=await open(dirname(file),'r');await directory.sync();await directory.close();directory=null;
   }
  }catch{
   // After rename, disk may already contain the candidate. Continuing from the old
   // in-memory state could resurrect a revoked phone or overwrite a spent invite.
   if(replaced){poisoned=true;throw fail(503,'ACCESS_STORE_UNCERTAIN');}
   throw fail(500,'ACCESS_WRITE_FAILED');
  }
  finally{
   if(handle)await handle.close().catch(()=>{});
   if(directory)await directory.close().catch(()=>{});
   await rm(temporary,{force:true}).catch(()=>{});
  }
 }
 let data;
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,token})+'\n');await lock.sync();
  try{
   const info=await lstat(file);
   if(!info.isFile()||info.size>8*1024*1024)throw fail(500,'INVALID_ACCESS_STORE');
   data=JSON.parse(await readFile(file,'utf8'));
  }
  catch(error){
   if(error.code!=='ENOENT')throw fail(500,'INVALID_ACCESS_STORE');
   if(!initialize)throw fail(500,'ACCESS_STORE_MISSING');
   data={version:1,kind:'dabots-phone-access',invites:[],phones:[],computers:[]};await save(data);
  }
  validate(data);
 }catch(error){await unlock();throw error;}
 let queue=Promise.resolve(),closed=false,closing;
 const listeners=new Set();
 function mutate(operation,afterCommit){
  if(poisoned)return Promise.reject(fail(503,'ACCESS_STORE_UNCERTAIN'));
  if(closed)return Promise.reject(fail(503,'ACCESS_CLOSED'));
  const result=queue.then(async()=>{
   if(poisoned)throw fail(503,'ACCESS_STORE_UNCERTAIN');
   const candidate=structuredClone(data);const value=operation(candidate);validate(candidate);await save(candidate);data=candidate;afterCommit?.(value);return value;
  });
  queue=result.catch(()=>{});return result;
 }
 return {
  issue({count=1,expiresInMs=86400000}={}){return mutate(candidate=>{
   const time=now();
   if(!Number.isSafeInteger(count)||count<1||count>4096||!Number.isSafeInteger(expiresInMs)||expiresInMs<1||!Number.isSafeInteger(time+expiresInMs))throw fail(400,'INVALID_ISSUE');
   if(candidate.invites.length+count>4096)throw fail(429,'INVITE_LIMIT');
   return Array.from({length:count},()=>{
    const code=randomBytes(24).toString('base64url'),id=randomBytes(16).toString('base64url'),expiresAt=time+expiresInMs;
    candidate.invites.push({id,hash:digest(code),createdAt:time,expiresAt,phoneId:null,redeemedAt:null});
    return {id,code,expiresAt};
   });
  });},
  redeem(code,key){return mutate(candidate=>{
   if(!encoded(key,32))throw fail(400,'INVALID_KEY');
   const existing=candidate.phones.find(p=>p.key===key);
   if(existing)throw fail(409,existing.revokedAt===null?'ALREADY_ENROLLED':'PHONE_REVOKED');
   if(!encoded(code,24))throw fail(403,'INVITE_UNAVAILABLE');
   const time=now(),invite=candidate.invites.find(i=>i.hash===digest(code));
   if(!invite||invite.phoneId!==null||invite.expiresAt<=time)throw fail(403,'INVITE_UNAVAILABLE');
   if(candidate.phones.length>=4096)throw fail(429,'PHONE_LIMIT');
   const id=phoneId(key);candidate.phones.push({id,key,enrolledAt:time,revokedAt:null});invite.phoneId=id;invite.redeemedAt=time;
   return {enrolled:true,phoneId:id};
  });},
  isPhone(key){return !closed&&!poisoned&&data.phones.some(p=>p.key===key&&p.revokedAt===null);},
  // Only call after validating the live computer's fresh QR nonce and full identity tuple.
  associate({phoneKey,computerId,computerKey,serverId}){return mutate(candidate=>{
   if(!encoded(phoneKey,32)||!encoded(computerId,16)||!encoded(computerKey,32)||!validServer(serverId))throw fail(400,'INVALID_ASSOCIATION');
   const phone=candidate.phones.find(p=>p.key===phoneKey&&p.revokedAt===null);
   if(!phone)throw fail(403,'PHONE_REQUIRED');
   const computer=candidate.computers.find(c=>c.id===computerId);
   if(computer){
    if(computer.computerKey!==computerKey||computer.serverId!==serverId)throw fail(409,'COMPUTER_IDENTITY_MISMATCH');
    if(computer.phoneId!==phone.id&&candidate.phones.find(p=>p.id===computer.phoneId)?.revokedAt===null)throw fail(409,'COMPUTER_OWNED');
    computer.phoneId=phone.id;computer.associatedAt=now();
   }else{
    if(candidate.computers.length>=4096)throw fail(429,'COMPUTER_LIMIT');
    candidate.computers.push({id:computerId,phoneId:phone.id,computerKey,serverId,associatedAt:now()});
   }
   return {associated:true};
  });},
  owner(computerId){
   if(closed||poisoned)return null;
   const computer=data.computers.find(c=>c.id===computerId);if(!computer)return null;
   return {phoneKey:data.phones.find(p=>p.id===computer.phoneId).key,computerKey:computer.computerKey,serverId:computer.serverId};
  },
  allows(key,id,computerKey,serverId){
   if(closed||poisoned)return false;
   const phone=data.phones.find(p=>p.key===key&&p.revokedAt===null);
   return !!phone&&data.computers.some(c=>c.id===id&&c.phoneId===phone.id&&c.computerKey===computerKey&&c.serverId===serverId);
  },
  revokePhone(id){return mutate(candidate=>{
   if(!encoded(id,16))throw fail(400,'INVALID_PHONE');
   const phone=candidate.phones.find(p=>p.id===id);if(!phone)throw fail(404,'PHONE_NOT_FOUND');
   phone.revokedAt??=now();return {phoneId:phone.id};
  },value=>{
   const key=data.phones.find(p=>p.id===value.phoneId).key;
   for(const listener of listeners){try{listener(key);}catch{/* A listener cannot roll back a durable revocation or prevent other listeners. */}}
  });},
  onRevoke(listener){if(typeof listener!=='function')throw fail(400,'INVALID_LISTENER');listeners.add(listener);return ()=>listeners.delete(listener);},
  list(){if(poisoned)throw fail(503,'ACCESS_STORE_UNCERTAIN');return {
   invites:data.invites.map(({id,createdAt,expiresAt,phoneId,redeemedAt})=>({id,createdAt,expiresAt,phoneId,redeemedAt})),
   phones:data.phones.map(({id,enrolledAt,revokedAt})=>({id,enrolledAt,revokedAt})),
   computers:data.computers.map(({id,phoneId,associatedAt})=>({id,phoneId,associatedAt})),
  };},
  close(){if(!closing){closed=true;closing=queue.then(unlock);}return closing;},
 };
}
