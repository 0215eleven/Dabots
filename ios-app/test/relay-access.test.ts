import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, createHash } from 'node:crypto';
import { createPhoneKey, createRelayAccess, signPhoneConnection, RelayAccessError } from '../src/logic/relay-access.ts';
import { createRelayKeyStore } from '../src/storage/relay-key-store.ts';
import { parsePairing } from '../src/logic/pairing.ts';

const relay = 'wss://relay.example';
const key = createPhoneKey(new Uint8Array(32).fill(7));
const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key.publicKey, 'base64url')]), type: 'spki', format: 'der' });
test('phone HTTP signatures interoperate with Node and bind the complete request', async () => {
  let counter = 0;
  const calls: Array<{url:string; init:RequestInit}> = [];
  const access = createRelayAccess({ relay: relay + '/', key, now: () => 1800000000000,
    randomBytes: n => new Uint8Array(n).fill(++counter), fetch: (async (url, init) => {
      calls.push({url:String(url), init:init!}); return Response.json(String(url).endsWith('status') ? {protocol:1,enrolled:false} : {enrolled:true,phoneId:'fixture'});
    }) as typeof fetch });
  assert.deepEqual(await access.status(), {protocol:1,enrolled:false});
  await access.redeem(' invitation ');
  for (const {url,init} of calls) {
    const headers = init.headers as Record<string,string>;
    const message = JSON.stringify(['dabots-phone-request-v1',relay,init.method,new URL(url).pathname,headers['x-dabots-time'],headers['x-dabots-nonce'],createHash('sha256').update(String(init.body ?? '')).digest('hex')]);
    assert.equal(verify(null,Buffer.from(message),publicKey,Buffer.from(headers['x-dabots-signature'],'base64url')),true);
    assert.equal(headers['x-dabots-phone-key'],key.publicKey);
    assert.equal(new URL(url).origin,'https://relay.example');
    assert.equal(init.redirect,'error');
  }
  assert.notEqual((calls[0].init.headers as any)['x-dabots-nonce'],(calls[1].init.headers as any)['x-dabots-nonce']);
  assert.deepEqual(JSON.parse(String(calls[1].init.body)),{code:'invitation'});
});
test('WS signatures bind exact challenge tuple', () => {
  const challenge = {relay,nonce:'A'.repeat(43),computerId:'A'.repeat(22),computerKey:'A'.repeat(43),serverId:'server'};
  const proof = signPhoneConnection(challenge,key);
  assert.equal(proof.type,'authenticate');
  const message = JSON.stringify(['dabots-phone-connect-v1',relay,challenge.nonce,challenge.computerId,challenge.computerKey,challenge.serverId]);
  assert.equal(verify(null,Buffer.from(message),publicKey,Buffer.from(proof.signature,'base64url')),true);
  assert.equal(verify(null,Buffer.from(message.replace('server','other')),publicKey,Buffer.from(proof.signature,'base64url')),false);
});
test('access refuses non-origin endpoints and hides remote error material', async () => {
  for (const value of ['https://relay.example','wss://relay.example/path','wss://user@relay.example','wss://relay.example?x'])
    assert.throws(() => createRelayAccess({relay:value,key,randomBytes:n=>new Uint8Array(n)}));
  const access = createRelayAccess({relay,key,randomBytes:n=>new Uint8Array(n),fetch:(async()=>Response.json({code:'PHONE_REVOKED',message:'secret invitation'}, {status:403})) as typeof fetch});
  await assert.rejects(access.redeem('secret invitation'), (error:any)=>error instanceof RelayAccessError && !error.message.includes('secret invitation'));
});
test('per-origin phone storage single-flights concurrent calls and resets explicitly', async () => {
  const saved = new Map<string,string>(); let writes = 0, seed = 0;
  const store = createRelayKeyStore({read:async name=>saved.get(name) ?? null,write:async(name,value)=>{writes++;saved.set(name,value);},randomBytes:n=>new Uint8Array(n).fill(++seed)});
  const [first,second] = await Promise.all([store.get(relay),store.get(relay+'/')]);
  assert.deepEqual(first,second); assert.equal(writes,1);
  assert.notDeepEqual(await store.get('wss://other.example'),first);
  const reset = await store.reset(relay); assert.notDeepEqual(reset,first);
  assert.deepEqual(await store.get(relay),reset);
  assert.ok([...saved.keys()].every(name=>!name.includes('admin')));
});
test('failed storage does not publish an identity and corrupt storage never silently resets it', async () => {
  let saved:string|null=null,fail=true,writes=0;
  const store=createRelayKeyStore({read:async()=>saved,write:async(_name,value)=>{writes++;if(fail)throw new Error('disk failure');saved=value;},randomBytes:n=>new Uint8Array(n).fill(writes+1)});
  const failed=await Promise.allSettled([store.get(relay),store.get(relay)]);
  assert.ok(failed.every(result=>result.status==='rejected'));assert.equal(writes,1);assert.equal(saved,null);
  fail=false;
  const recovered=await store.get(relay);assert.equal(writes,2);
  assert.deepEqual(await store.get(relay),recovered);
  saved='{"publicKey":"broken","secretKey":"broken"}';
  await assert.rejects(store.get(relay),/Invalid phone identity/);assert.equal(writes,2);
  const reset=await store.reset(relay);assert.equal(writes,3);assert.notDeepEqual(reset,recovered);
});
test('official QR requires access protocol, canonical live nonce; custom legacy remains usable', () => {
  const previous = process.env.EXPO_PUBLIC_DABOTS_OFFICIAL_RELAY;
  process.env.EXPO_PUBLIC_DABOTS_OFFICIAL_RELAY=relay;
  try {
    const qr = {v:2,relay,computerId:'A'.repeat(22),computerKey:'A'.repeat(43),serverId:'server',code:'pair'};
    assert.throws(()=>parsePairing(JSON.stringify(qr)),/new code|upgrade/i);
    assert.equal(parsePairing(JSON.stringify({...qr,relay:'wss://custom.example'})).kind,'relay');
    const access = {access:1,linkNonce:'A'.repeat(43),linkExpiresAt:Date.now()+60000};
    assert.equal((parsePairing(JSON.stringify({...qr,...access})) as any).access,1);
    for (const bad of [{access:2},{linkNonce:'B'.repeat(43)},{linkExpiresAt:1},{linkExpiresAt:'later'}])
      assert.throws(()=>parsePairing(JSON.stringify({...qr,...access,...bad})));
  } finally { if (previous===undefined) delete process.env.EXPO_PUBLIC_DABOTS_OFFICIAL_RELAY; else process.env.EXPO_PUBLIC_DABOTS_OFFICIAL_RELAY=previous; }
});
