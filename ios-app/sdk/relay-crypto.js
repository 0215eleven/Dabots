// Happy-derived envelopes plus BOT-specific session binding. Not an audited protocol.
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {encode,decode} from '@stablelib/base64';
import {keyPair,wrapKey,unwrapKey,seal,open,randomBytesFrom} from './vendor/happy-envelope.js';
const utf8=new TextEncoder(),text=new TextDecoder('utf-8',{fatal:true});
const bytes=value=>utf8.encode(JSON.stringify(value));
const json=value=>JSON.parse(text.decode(value));
const domain='ds-bot-relay-v2';
function binding(context){
 const values=['relay','computerId','serverId','streamId','epoch'].map(key=>context?.[key]);
 if(values.some(x=>typeof x!=='string'||!x||x.length>512))throw new Error('Invalid relay session context.');
 const relay=new URL(values[0]);if(relay.protocol!=='wss:'||relay.username||relay.password||relay.search||relay.hash||relay.pathname!=='/')throw new Error('Invalid relay origin.');
 return JSON.stringify([domain,...values]);
}
export const createBoxKeyPair=keyPair;
function peer(seed,context,role,randomBytes){
 const bound=binding(context),outDirection=role==='phone'?'phone-to-bridge':'bridge-to-phone';
 const inDirection=role==='phone'?'bridge-to-phone':'phone-to-bridge';
 const derive=direction=>hkdf(sha256,seed,utf8.encode(bound),utf8.encode(`${domain}/${direction}`),32);
 const outgoing=derive(outDirection),incoming=derive(inDirection);seed.fill(0);
 let phase=role==='phone'?'wait-ready':'wait-finish',sent=0,received=0,closed=false;
 function close(){closed=true;phase='closed';outgoing.fill(0);incoming.fill(0);}
 function pack(message){
  if(closed||!Number.isSafeInteger(sent)||sent>=Number.MAX_SAFE_INTEGER)throw new Error('Relay session closed.');
  const plain=bytes([2,bound,outDirection,sent,message]);
  if(plain.length>65536)throw new Error('Relay record too large.');
  const record=seal(plain,outgoing,randomBytes);sent++;return record;
 }
 function send(message){
  if(closed||phase!=='active')throw new Error('Relay key confirmation required.');
  if(!message||typeof message.kind!=='string'||['ready','finish'].includes(message.kind))throw new Error('Invalid relay message.');
  return pack(message);
 }
 function receive(record){
  if(closed)throw new Error('Relay session closed.');
  try{
   const value=json(open(record,incoming));
   if(!Array.isArray(value)||value.length!==5||value[0]!==2||value[1]!==bound||value[2]!==inDirection||!Number.isSafeInteger(value[3])||value[3]!==received)throw new Error('Relay session binding or sequence mismatch.');
   const message=value[4];if(!message||typeof message.kind!=='string')throw new Error('Invalid relay message.');
   received++;
   if(phase==='wait-ready'){
    if(message.kind!=='ready')throw new Error('Relay key confirmation required.');
    const finish=pack({kind:'finish'});phase='active';return finish;
   }
   if(phase==='wait-finish'){
    if(message.kind!=='finish')throw new Error('Relay key confirmation required.');phase='active';return null;
   }
   if(['ready','finish'].includes(message.kind))throw new Error('Repeated key confirmation.');
   return message;
  }catch{close();throw new Error('Invalid encrypted relay session.');}
 }
 return {send,receive,close,get confirmed(){return !closed&&phase==='active';},initialReady:()=>pack({kind:'ready'})};
}
export function createPhoneHandshake({computerKey,context,randomBytes}){
 const bound=binding(context),seed=randomBytesFrom(randomBytes,32);
 try{const offer=wrapKey(bytes([domain,bound,encode(seed)]),computerKey,randomBytes);const channel=peer(seed,context,'phone',randomBytes);return {send:channel.send,receive:channel.receive,close:channel.close,get confirmed(){return channel.confirmed;},offer};}
 finally{seed.fill(0);}
}
export function acceptPhoneHandshake({offer,computerSecret,context,randomBytes}){
 const bound=binding(context),plain=unwrapKey(offer,computerSecret);let seed;
 try{const value=json(plain);if(!Array.isArray(value)||value.length!==3||value[0]!==domain||value[1]!==bound||typeof value[2]!=='string')throw new Error('Invalid key envelope context.');
  seed=decode(value[2]);if(seed.length!==32)throw new Error('Invalid session seed.');
  const channel=peer(seed,context,'bridge',randomBytes),ready=channel.initialReady();return {send:channel.send,receive:channel.receive,close:channel.close,get confirmed(){return channel.confirmed;},ready};
 }finally{plain.fill(0);seed?.fill(0);}
}
