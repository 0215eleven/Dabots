import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {createAccess} from '../access.mjs';

const key=()=>randomBytes(32).toString('base64url');
const id=()=>randomBytes(16).toString('base64url');
const phoneId=k=>createHash('sha256').update(Buffer.from(k,'base64url')).digest().subarray(0,16).toString('base64url');
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'dabots-access-test-'));
 const file=join(dir,'access.json');
 const access=await createAccess({file,initialize:true,...options});
 t.after(async()=>{await access.close();await rm(dir,{recursive:true,force:true});});
 return {access,file,dir};
}

// Exercise the supported-platform durability path on Windows too. Real file writes and
// rename remain intact; only the directory handle is replaced to control its sync result.
async function withDirectorySync(dir,sync,operation){
 const directory=await fsPromises.realpath(dir),originalOpen=fsPromises.open,platform=Object.getOwnPropertyDescriptor(process,'platform');
 fsPromises.open=async(path,flags,...rest)=>path===directory&&flags==='r'?{sync,close:async()=>{}}:originalOpen(path,flags,...rest);
 Object.defineProperty(process,'platform',{...platform,value:'linux'});syncBuiltinESMExports();
 try{return await operation();}
 finally{fsPromises.open=originalOpen;Object.defineProperty(process,'platform',platform);syncBuiltinESMExports();}
}

test('supported platforms publish enrollment only after the directory commit completes',async t=>{
 const {access,dir}=await fixture(t),first=key();
 const [invite]=await access.issue();
 let synced=0;
 await withDirectorySync(dir,async()=>{synced++;assert.equal(access.isPhone(first),false);},async()=>{
  await access.redeem(invite.code,first);
 });
 assert.equal(synced,1,'the containing directory must be synced after rename');
 assert.equal(access.isPhone(first),true);
});

test('a failed directory commit poisons authorization and queued writes without publishing enrollment or revocation',async t=>{
 for(const action of ['enroll','revoke'])await t.test(action,async t=>{
  const {access,file,dir}=await fixture(t),first=key(),second=key();
  const [invite,spare]=await access.issue({count:2});await access.redeem(invite.code,first);
  const desk={phoneKey:first,computerId:id(),computerKey:key(),serverId:'fixture'};await access.associate(desk);
  let notifications=0;access.onRevoke(()=>notifications++);
  let directoryCalls=0;
  await withDirectorySync(dir,async()=>{directoryCalls++;throw Object.assign(Error('fixture fsync failed'),{code:'EIO'});},async()=>{
   const mutation=action==='enroll'?access.redeem(spare.code,second):access.revokePhone(phoneId(first));
   const queued=access.issue();
   const results=await Promise.allSettled([mutation,queued]);
   assert.deepEqual(results.map(r=>[r.status,r.reason?.code]),[['rejected','ACCESS_STORE_UNCERTAIN'],['rejected','ACCESS_STORE_UNCERTAIN']]);
  });
  assert.equal(directoryCalls,1,'queued mutations cannot replace uncertain disk state');
  assert.equal(access.isPhone(first),false);assert.equal(access.isPhone(second),false);
  assert.equal(access.allows(first,desk.computerId,desk.computerKey,desk.serverId),false);
  assert.equal(access.owner(desk.computerId),null);assert.equal(notifications,0);
  assert.throws(()=>access.list(),{code:'ACCESS_STORE_UNCERTAIN'});
  await assert.rejects(access.issue(),{code:'ACCESS_STORE_UNCERTAIN'});
  await assert.rejects(createAccess({file}),{code:'ACCESS_LOCKED'},'uncertain store retains its lifetime lock until close');
  const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.invites.length,2);
  if(action==='enroll')assert.equal(saved.phones.some(p=>p.id===phoneId(second)),true);
  else assert.notEqual(saved.phones.find(p=>p.id===phoneId(first)).revokedAt,null);
  await access.close();
  const reopened=await createAccess({file});
  try{assert.equal(reopened.isPhone(first),action==='enroll');assert.equal(reopened.isPhone(second),action==='enroll');}
  finally{await reopened.close();}
 });
});

test('an invitation enrolls exactly one phone, persists only a hash, and reloads',async t=>{
 const {access,file}=await fixture(t),first=key(),other=key();
 const [invite]=await access.issue();
 assert.match(invite.code,/^[A-Za-z0-9_-]{32}$/);
 assert.equal((await readFile(file,'utf8')).includes(invite.code),false);
 assert.deepEqual(await access.redeem(invite.code,first),{enrolled:true,phoneId:phoneId(first)});
 assert.equal(access.isPhone(first),true);
 await assert.rejects(access.redeem(invite.code,other),{code:'INVITE_UNAVAILABLE'});
 await access.close();
 const reopened=await createAccess({file});
 try{assert.equal(reopened.isPhone(first),true);assert.equal(reopened.isPhone(other),false);}
 finally{await reopened.close();}
});

test('one phone owns multiple computers; revocation retains a tombstone and permits replacement ownership',async t=>{
 const {access,file}=await fixture(t),first=key(),second=key();
 const invites=await access.issue({count:3});
 await access.redeem(invites[0].code,first);await access.redeem(invites[1].code,second);
 const desk={phoneKey:first,computerId:id(),computerKey:key(),serverId:'fixture-server'};
 const laptop={phoneKey:first,computerId:id(),computerKey:key(),serverId:'other-server'};
 await access.associate(desk);await access.associate(laptop);
 assert.equal(access.allows(first,desk.computerId,desk.computerKey,desk.serverId),true);
 assert.equal(access.allows(first,laptop.computerId,laptop.computerKey,laptop.serverId),true);
 assert.equal(access.allows(second,desk.computerId,desk.computerKey,desk.serverId),false);
 assert.deepEqual(access.owner(desk.computerId),{phoneKey:first,computerKey:desk.computerKey,serverId:desk.serverId});
 await assert.rejects(access.associate({...desk,phoneKey:second}),{code:'COMPUTER_OWNED'});
 await assert.rejects(access.associate({...desk,computerKey:key()}),{code:'COMPUTER_IDENTITY_MISMATCH'});
 await assert.rejects(access.associate({...desk,serverId:'wrong'}),{code:'COMPUTER_IDENTITY_MISMATCH'});
 let revoked;
 access.onRevoke(k=>{revoked=k;assert.equal(access.isPhone(k),false);});
 await access.revokePhone(phoneId(first));
 assert.equal(revoked,first);
 assert.equal(access.isPhone(first),false);
 assert.equal(access.allows(first,desk.computerId,desk.computerKey,desk.serverId),false);
 await assert.rejects(access.redeem(invites[2].code,first),{code:'PHONE_REVOKED'});
 await assert.rejects(access.associate({...desk,phoneKey:second,computerKey:key()}),{code:'COMPUTER_IDENTITY_MISMATCH'});
 // The caller validates a fresh live QR before this internal association operation.
 await access.associate({...desk,phoneKey:second});
 assert.equal(access.allows(second,desk.computerId,desk.computerKey,desk.serverId),true);
 const listing=JSON.stringify(access.list());
 for(const secret of [first,second,desk.computerKey,...invites.map(i=>i.code)])assert.equal(listing.includes(secret),false);
 await access.close();
 const reopened=await createAccess({file});
 try{assert.equal(reopened.isPhone(first),false);assert.equal(reopened.allows(second,desk.computerId,desk.computerKey,desk.serverId),true);await assert.rejects(reopened.redeem(invites[2].code,first),{code:'PHONE_REVOKED'});}
 finally{await reopened.close();}
});

test('expiry, canonical inputs and concurrent redemption fail closed; status supports lost-response retry',async t=>{
 let time=1000;
 const {access}=await fixture(t,{now:()=>time}),first=key(),second=key();
 const [expired,live,spare]=await access.issue({count:3,expiresInMs:100});
 time=1100;await assert.rejects(access.redeem(expired.code,first),{code:'INVITE_UNAVAILABLE'});
 time=1050;
 const results=await Promise.allSettled([access.redeem(live.code,first),access.redeem(live.code,second)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(access.isPhone(first),true);
 await assert.rejects(access.redeem(live.code,first),{code:'ALREADY_ENROLLED'});
 await assert.rejects(access.redeem(spare.code,first),{code:'ALREADY_ENROLLED'});
 await access.redeem(spare.code,second);
 await assert.rejects(access.redeem('not-a-code',key()),{code:'INVITE_UNAVAILABLE'});
 await assert.rejects(access.redeem(expired.code,first+'='),{code:'INVALID_KEY'});
});

test('failed saves publish no grants, preserve revocation authority, and do not poison the mutation queue',async t=>{
 const {access,file}=await fixture(t),first=key();
 const [invite]=await access.issue();
 async function obstruct(action){
  await rename(file,file+'.backup');await mkdir(file);
  try{await action();}finally{await rm(file,{recursive:true});await rename(file+'.backup',file);}
 }
 await obstruct(async()=>{
  await assert.rejects(access.redeem(invite.code,first),{code:'ACCESS_WRITE_FAILED'});
  assert.equal(access.isPhone(first),false);
  await assert.rejects(access.issue(),{code:'ACCESS_WRITE_FAILED'});
 });
 const pending=access.redeem(invite.code,first);assert.equal(access.isPhone(first),false);await pending;
 const desk={phoneKey:first,computerId:id(),computerKey:key(),serverId:'fixture'};
 await obstruct(async()=>{await assert.rejects(access.associate(desk),{code:'ACCESS_WRITE_FAILED'});assert.equal(access.owner(desk.computerId),null);});
 await access.associate(desk);
 let notifications=0;access.onRevoke(()=>notifications++);
 await obstruct(async()=>{await assert.rejects(access.revokePhone(phoneId(first)),{code:'ACCESS_WRITE_FAILED'});assert.equal(access.isPhone(first),true);assert.equal(notifications,0);});
 await access.revokePhone(phoneId(first));assert.equal(notifications,1);assert.equal(access.isPhone(first),false);
});

test('malformed, noncanonical, duplicate and inconsistent persisted records are rejected',async t=>{
 const {access,file}=await fixture(t),first=key();
 const [invite]=await access.issue();await access.redeem(invite.code,first);
 await access.associate({phoneKey:first,computerId:id(),computerKey:key(),serverId:'fixture'});
 await access.close();
 const original=JSON.parse(await readFile(file,'utf8'));
 const badTail=value=>value.slice(0,-1)+'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.charAt('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(value.at(-1))+1);
 const cases=[
  s=>{s.kind='legacy';},s=>{s.version=2;},s=>{s.extra='secret';},s=>{delete s.invites;},
  s=>{s.phones[0].key+='=';},s=>{s.phones[0].key=badTail(s.phones[0].key);},
  s=>{s.phones[0].id=id();},s=>{s.phones.push({...s.phones[0]});},
  s=>{s.phones[0].revokedAt=1;},s=>{s.phones[0].enrolledAt=-1;},
  s=>{s.invites[0].hash+='=';},s=>{s.invites[0].id=badTail(s.invites[0].id);},
  s=>{s.invites.push({...s.invites[0]});},s=>{s.invites[0].phoneId=id();},
  s=>{s.invites[0].redeemedAt=null;},s=>{s.invites[0].expiresAt=s.invites[0].createdAt;},
  s=>{s.invites[0].code=invite.code;},s=>{s.invites[0].redeemedAt=s.invites[0].expiresAt;},
  s=>{s.computers[0].id=badTail(s.computers[0].id);},s=>{s.computers[0].computerKey=badTail(s.computers[0].computerKey);},
  s=>{s.computers[0].phoneId=id();},s=>{s.computers.push({...s.computers[0]});},
  s=>{s.computers[0].serverId='';},s=>{s.computers[0].serverId='x\n';},
  s=>{s.computers[0].serverId='x'.repeat(129);},s=>{s.computers[0].associatedAt=0;},
  s=>{s.invites=Array(4097).fill(s.invites[0]);},s=>{s.phones=Array(4097).fill(s.phones[0]);},s=>{s.computers=Array(4097).fill(s.computers[0]);},
 ];
 for(const [index,change] of cases.entries()){
  const corrupt=structuredClone(original);change(corrupt);await writeFile(file,JSON.stringify(corrupt));
  await assert.rejects(createAccess({file}),{code:'INVALID_ACCESS_STORE'},'case '+index);
 }
 await writeFile(file,'{');await assert.rejects(createAccess({file}),{code:'INVALID_ACCESS_STORE'});
 await writeFile(file,JSON.stringify(original));const reopened=await createAccess({file});await reopened.close();
});

test('invitation capacity is bounded, inputs are checked, and returned views cannot mutate state',async t=>{
 const {access}=await fixture(t);
 for(const options of [{count:0},{count:1.5},{count:4097},{expiresInMs:0},{expiresInMs:-1},{expiresInMs:Number.MAX_SAFE_INTEGER}])await assert.rejects(access.issue(options),{code:'INVALID_ISSUE'});
 const issued=await access.issue({count:4096});assert.equal(issued.length,4096);
 await assert.rejects(access.issue(),{code:'INVITE_LIMIT'});
 const snapshot=access.list();snapshot.invites.length=0;assert.equal(access.list().invites.length,4096);
 const first=key();
 const results=await Promise.allSettled([access.redeem(issued[0].code,first),access.redeem(issued[0].code,first)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'ALREADY_ENROLLED');
});

test('computer capacity, pending close and lock ownership preserve committed state',async t=>{
 const {access,file}=await fixture(t),first=key();
 const [invite]=await access.issue();await access.redeem(invite.code,first);await access.close();
 const data=JSON.parse(await readFile(file,'utf8'));
 data.computers=Array.from({length:4096},()=>({id:id(),phoneId:phoneId(first),computerKey:key(),serverId:'fixture',associatedAt:data.phones[0].enrolledAt}));
 await writeFile(file,JSON.stringify(data));
 const reopened=await createAccess({file});
 try{
  await assert.rejects(reopened.associate({phoneKey:first,computerId:id(),computerKey:key(),serverId:'fixture'}),{code:'COMPUTER_LIMIT'});
  let listeners=0;reopened.onRevoke(()=>{throw Error('fixture observer failure');});reopened.onRevoke(()=>listeners++);
  const pending=reopened.revokePhone(phoneId(first)),closing=reopened.close();
  await assert.rejects(reopened.issue(),{code:'ACCESS_CLOSED'});
  await pending;await closing;assert.equal(listeners,1);
 }finally{await reopened.close();}
 const last=await createAccess({file});assert.equal(last.isPhone(first),false);
 const foreign='{"pid":2147483647,"token":"replacement-fixture"}';await writeFile(file+'.lock',foreign);
 await last.close();assert.equal(await readFile(file+'.lock','utf8'),foreign,'close never removes another lock owner');
});
