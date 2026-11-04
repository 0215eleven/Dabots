import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {createRelay} from '../server.mjs';

const origin='wss://fixture.example';
const hash=x=>createHash('sha256').update(x).digest('hex');
const keypair=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,key:pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url')};};
const msg=(...parts)=>Buffer.from(JSON.stringify(parts));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t,options={}){
 const {createAccess}=await import('../access.mjs');
 const dir=await mkdtemp(join(tmpdir(),'relay-access-protocol-'));
 const access=await createAccess({file:join(dir,'access.json'),initialize:true});
 let relay;
 t.after(async()=>{await relay?.close();await access.close();await rm(dir,{recursive:true,force:true});});
 relay=await createRelay({origin,access,...options});
 const phone=()=>{
  const keys=keypair();
  const call=async(method,path,input,extra={})=>{
   const body=input?JSON.stringify(input):'',time=Date.now(),nonce=randomBytes(16).toString('base64url');
   const signature=sign(null,msg('dabots-phone-request-v1',origin,method,path,String(time),nonce,hash(body)),keys.privateKey).toString('base64url');
   const init={method,headers:{'content-type':'application/json','x-dabots-phone-key':keys.key,'x-dabots-time':String(time),'x-dabots-nonce':nonce,'x-dabots-signature':signature,...extra},...(body?{body}:{})};
   const send=async()=>{const response=await fetch(relay.url+path,init);return {status:response.status,body:await response.json()};};
   return {...await send(),repeat:send};
  };
  const enroll=async()=>{const [invite]=await access.issue({});const result=await call('POST','/v1/access/redeem',{code:invite.code});assert.equal(result.status,200);return result.body;};
  return {...keys,call,enroll};
 };
 const computer=async(existing)=>{
  const keys=existing?.keys??keypair(),computerKey=existing?.computerKey??randomBytes(32).toString('base64url'),serverId='fixture-server';
  const computerId=createHash('sha256').update(Buffer.from(keys.key,'base64url')).digest().subarray(0,16).toString('base64url');
  const ws=new WebSocket(relay.url.replace('http:','ws:')+'/v1/computer');ws.on('error',()=>{});
  const [data]=await once(ws,'message'),challenge=JSON.parse(data);
  assert.equal(challenge.access,1);
  ws.send(JSON.stringify({type:'register',nonce:challenge.nonce,version:3,computerId,edPublicKey:keys.key,computerKey,serverId,signature:sign(null,msg('ds-bot-computer-v3',origin,challenge.nonce,computerId,keys.key,computerKey,serverId),keys.privateKey).toString('base64url')}));
  const reply=await new Promise((resolve,reject)=>{ws.once('message',resolve);ws.once('close',code=>reject(Error(`Registration refused: ${code}`)));});const pending=JSON.parse(reply);
  const owner=access.owner(computerId);
  assert.equal(pending.type,owner&&access.isPhone(owner.phoneKey)?'registered':'pending');assert.match(pending.linkNonce,/^[A-Za-z0-9_-]{43}$/);
  t.after(()=>ws.terminate());
  return {keys,ws,computerId,computerKey,serverId,linkNonce:pending.linkNonce};
 };
 const connect=async(phone,computer,{badSignature=false,reuseSignature}={})=>{
  const ws=new WebSocket(relay.url.replace('http:','ws:')+'/v1/phone?computer='+computer.computerId,{origin:'https://fixture.example'});ws.on('error',()=>{});t.after(()=>ws.terminate());
  const [frame]=await once(ws,'message'),challenge=JSON.parse(frame);assert.equal(challenge.type,'phone-challenge');
  const signature=sign(null,msg('dabots-phone-connect-v1',origin,challenge.nonce,computer.computerId,computer.computerKey,computer.serverId),phone.privateKey).toString('base64url');
  ws.proof=signature;
  ws.send(JSON.stringify({type:'authenticate',key:phone.key,signature:reuseSignature??(badSignature?randomBytes(64).toString('base64url'):signature)}));
  return ws;
 };
 return {access,relay,phone,computer,connect};
}

test('invite mode rejects mixing old public admission with phone invitations',async()=>{
 let relay;
 try{await assert.rejects(async()=>{relay=await createRelay({origin,access:{},openRegistration:true});},/invit|access|legacy|mix/i);}
 finally{await relay?.close();}
});

test('signed invitation enrollment and status reject replay, browser origin and query changes',async t=>{
 const f=await fixture(t),phone=f.phone();
 assert.deepEqual((await phone.call('GET','/v1/access/status')).body,{protocol:1,enrolled:false});
 const enrolled=await phone.enroll();assert.equal(enrolled.enrolled,true);
 const result=await phone.call('GET','/v1/access/status');assert.equal(result.body.enrolled,true);
 assert.equal((await result.repeat()).status,409);
 assert.equal((await phone.call('GET','/v1/access/status',undefined,{origin:'https://evil.example'})).status,403);
 assert.equal((await phone.call('GET','/v1/access/status?extra=1')).status,400);
 assert.equal((await fetch(f.relay.url+'/v1/admin/status')).status,404);
});

test('a registered computer waits for an invited phone and rejects guessed or mismatched QR association',async t=>{
 const f=await fixture(t),phone=f.phone(),computer=await f.computer();
 const request={computerId:computer.computerId,computerKey:computer.computerKey,serverId:computer.serverId,linkNonce:computer.linkNonce};
 assert.equal((await phone.call('POST','/v1/access/associate',request)).status,403);
 await phone.enroll();
 for(const bad of [{linkNonce:randomBytes(32).toString('base64url')},{computerKey:randomBytes(32).toString('base64url')},{serverId:'other'}])assert.equal((await phone.call('POST','/v1/access/associate',{...request,...bad})).status,409);
 const promoted=once(computer.ws,'message');assert.equal((await phone.call('POST','/v1/access/associate',request)).status,200);
 assert.equal(JSON.parse((await promoted)[0]).type,'registered');
});

test('one invited phone owns two computers, another phone cannot steal or open a stream',async t=>{
 const f=await fixture(t),phone=f.phone(),other=f.phone();await phone.enroll();await other.enroll();
 for(let i=0;i<2;i++){
  const computer=await f.computer(),body={computerId:computer.computerId,computerKey:computer.computerKey,serverId:computer.serverId,linkNonce:computer.linkNonce};
  assert.equal((await phone.call('POST','/v1/access/associate',body)).status,200);
  assert.equal((await other.call('POST','/v1/access/associate',body)).status,409);
  assert.equal(f.access.allows(other.key,computer.computerId,computer.computerKey,computer.serverId),false);
  let opens=0;computer.ws.on('message',data=>{if(JSON.parse(data).type==='open')opens++;});
  const denied=await f.connect(other,computer);const [code]=await once(denied,'close');assert.equal(code,4403);assert.equal(opens,0);
  const ws=await f.connect(phone,computer);assert.equal(JSON.parse((await once(ws,'message'))[0]).type,'connected');assert.equal(opens,1);
 }
});

test('old computer registrations and binary-before-phone-auth cannot bypass admission',async t=>{
 const f=await fixture(t),phone=f.phone();await phone.enroll();
 const old=new WebSocket(f.relay.url.replace('http:','ws:')+'/v1/computer');old.on('error',()=>{});t.after(()=>old.terminate());
 const [frame]=await once(old,'message');old.send(JSON.stringify({type:'register',nonce:JSON.parse(frame).nonce}));
 assert.equal((await once(old,'close'))[0],4403);
 const computer=await f.computer();await phone.call('POST','/v1/access/associate',{computerId:computer.computerId,computerKey:computer.computerKey,serverId:computer.serverId,linkNonce:computer.linkNonce});
 const ws=new WebSocket(f.relay.url.replace('http:','ws:')+'/v1/phone?computer='+computer.computerId);ws.on('error',()=>{});t.after(()=>ws.terminate());
 await once(ws,'message');ws.send(Buffer.from('unauthorized-ciphertext'));
 assert.equal((await once(ws,'close'))[0],4403);
 const bad=await f.connect(phone,computer,{badSignature:true});assert.equal((await once(bad,'close'))[0],4403);
});

test('a live computer receives fresh QR link nonces, and old links are rejected',async t=>{
 const f=await fixture(t),phone=f.phone();await phone.enroll();const computer=await f.computer();
 const input={computerId:computer.computerId,computerKey:computer.computerKey,serverId:computer.serverId,linkNonce:computer.linkNonce};
 t.mock.timers.enable({apis:['setInterval']});
 // The link's interval already exists, so this second connection is the long-running one.
 const current=await f.computer();
 const promoted=once(current.ws,'message');
 await phone.call('POST','/v1/access/associate',{computerId:current.computerId,computerKey:current.computerKey,serverId:current.serverId,linkNonce:current.linkNonce});
 assert.equal(JSON.parse((await promoted)[0]).type,'registered');
 const refreshed=once(current.ws,'message');t.mock.timers.tick(240000);
 const next=JSON.parse((await refreshed)[0]);assert.equal(next.type,'link');assert.notEqual(next.linkNonce,current.linkNonce);
 assert.equal((await phone.call('POST','/v1/access/associate',{...input,computerId:current.computerId,computerKey:current.computerKey,serverId:current.serverId,linkNonce:current.linkNonce})).status,409);
 assert.equal((await phone.call('POST','/v1/access/associate',{...input,computerId:current.computerId,computerKey:current.computerKey,serverId:current.serverId,linkNonce:next.linkNonce})).status,200);
});

test('uninvited waiting computers cannot consume enrolled reconnect capacity and expire absolutely',async t=>{
 const f=await fixture(t,{limits:{maxComputers:1,pendingTimeoutMs:1000,maxPendingComputers:1,registrationPerHour:2}}),phone=f.phone();await phone.enroll();
 const owned=await f.computer();
 await phone.call('POST','/v1/access/associate',{computerId:owned.computerId,computerKey:owned.computerKey,serverId:owned.serverId,linkNonce:owned.linkNonce});
 const oldClosed=once(owned.ws,'close');owned.ws.close();await oldClosed;
 const stranger=await f.computer();
 await assert.rejects(f.computer(),/Registration refused: 4429/);
 const reconnected=await f.computer(owned);assert.equal(reconnected.computerId,owned.computerId);
 assert.equal((await once(stranger.ws,'close'))[0],4408);
});

test('a recorded phone connection signature cannot be replayed on a fresh socket challenge',async t=>{
 const f=await fixture(t),phone=f.phone();await phone.enroll();const computer=await f.computer();
 await phone.call('POST','/v1/access/associate',{computerId:computer.computerId,computerKey:computer.computerKey,serverId:computer.serverId,linkNonce:computer.linkNonce});
 const first=await f.connect(phone,computer);assert.equal(JSON.parse((await once(first,'message'))[0]).type,'connected');
 const replay=await f.connect(phone,computer,{reuseSignature:first.proof});assert.equal((await once(replay,'close'))[0],4403);
 assert.equal(first.readyState,WebSocket.OPEN);
});

test('an association delayed at persistence cannot consume the previous registration QR',async t=>{
 const f=await fixture(t),phone=f.phone();await phone.enroll();const old=await f.computer();
 let release,entered;const hold=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const associate=f.access.associate.bind(f.access);
 t.mock.method(f.access,'associate',async(...args)=>{entered();await hold;return associate(...args);});
 const pending=phone.call('POST','/v1/access/associate',{computerId:old.computerId,computerKey:old.computerKey,serverId:old.serverId,linkNonce:old.linkNonce});
 await started;
 try{
  const closed=once(old.ws,'close');old.ws.close();await closed;
  const fresh=await f.computer(old);assert.notEqual(fresh.linkNonce,old.linkNonce);
 }finally{release();}
 const result=await pending;assert.equal(result.status,409);assert.equal(result.body.code,'INVALID_LINK');
 assert.equal(f.access.owner(old.computerId),null);
});

test('a queued pre-revocation QR cannot transfer a computer after its owner is revoked',async t=>{
 const f=await fixture(t),owner=f.phone(),replacement=f.phone(),enrolled=await owner.enroll();await replacement.enroll();const old=await f.computer();
 const input={computerId:old.computerId,computerKey:old.computerKey,serverId:old.serverId,linkNonce:old.linkNonce};
 await owner.call('POST','/v1/access/associate',input);
 let release,entered;const hold=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const associate=f.access.associate.bind(f.access);let first=true;
 t.mock.method(f.access,'associate',async(...args)=>{if(first){first=false;entered();await hold;}return associate(...args);});
 const pending=replacement.call('POST','/v1/access/associate',input);await started;
 try{const closed=once(old.ws,'close');await f.access.revokePhone(enrolled.phoneId);await closed;}finally{release();}
 assert.equal((await pending).status,409);assert.equal(f.access.owner(old.computerId).phoneKey,owner.key);
 const fresh=await f.computer(old),promoted=once(fresh.ws,'message');
 assert.equal((await replacement.call('POST','/v1/access/associate',{...input,linkNonce:fresh.linkNonce})).status,200);
 assert.equal(JSON.parse((await promoted)[0]).type,'registered');
});

test('a phone cannot associate a QR after its server-side expiry',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=await fixture(t),phone=f.phone();await phone.enroll();const computer=await f.computer();
 t.mock.timers.setTime(Date.now()+300001);
 assert.equal((await phone.call('POST','/v1/access/associate',{computerId:computer.computerId,computerKey:computer.computerKey,serverId:computer.serverId,linkNonce:computer.linkNonce})).status,409);
});

test('revocation closes both directions immediately and old signatures cannot reconnect',async t=>{
 const f=await fixture(t),phone=f.phone(),enrolled=await phone.enroll(),computer=await f.computer();
 await phone.call('POST','/v1/access/associate',{computerId:computer.computerId,computerKey:computer.computerKey,serverId:computer.serverId,linkNonce:computer.linkNonce});
 const ws=await f.connect(phone,computer);const [ready]=await once(ws,'message'),streamId=JSON.parse(ready).streamId;
 const sent=once(computer.ws,'message');ws.send(Buffer.from('ciphertext'));assert.equal((await sent)[0].subarray(16).toString(),'ciphertext');
 const received=once(ws,'message');computer.ws.send(Buffer.concat([Buffer.from(streamId,'base64url'),Buffer.from('reply')]));assert.equal((await received)[0].toString(),'reply');
 const closed=once(ws,'close'),computerClosed=once(computer.ws,'close');
 await f.access.revokePhone(enrolled.phoneId);assert.equal(f.access.isPhone(phone.key),false);
 await Promise.all([closed,computerClosed]);
 assert.equal((await phone.call('GET','/v1/access/status')).body.enrolled,false);
 await delay(5);assert.equal(ws.readyState,WebSocket.CLOSED);assert.equal(computer.ws.readyState,WebSocket.CLOSED);
});
