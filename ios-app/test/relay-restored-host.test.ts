import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createPhoneKey, signPhoneConnection } from '../src/logic/relay-access.ts';
import { relayOrigin } from '../src/logic/pairing.ts';

const {transformSync}=createRequire(import.meta.url)('esbuild');
test('restored official hosts keep credentials and demand auth; self-hosted legacy retains compatibility',async()=>{
  const captured:any[]=[],keyOrigins:string[]=[];
  const key=createPhoneKey(new Uint8Array(32).fill(3));
  const session={serverId:'server',tlsPin:'pin',accessToken:'saved-token'};
  const tokenStore={get:async()=>session};
  class MobileClient { constructor(options:any){Object.assign(this,options);} dispose(){} }
  const mocks:Record<string,any>={
    expo:{requireOptionalNativeModule:()=>null},'react-native':{Platform:{OS:'web'}},'@ds-bot/mobile-sdk':{MobileClient},
    '@ds-bot/mobile-sdk/relay-transport':{createRelayTransport:(options:any)=>{captured.push(options);return {baseUrl:'https://synthetic.invalid',tlsPin:'pin',fetch:()=>{},WebSocket:class{},dispose(){}};}},
    'expo-crypto':{getRandomBytes:(n:number)=>new Uint8Array(n)},
    '../storage/relay-key':{relayPhoneKey:async(origin:string)=>{keyOrigins.push(origin);return key;}},
    '../logic/relay-access':{signPhoneConnection},'../logic/pairing':{relayOrigin},'../logic/hosts':{officialRelay:()=> 'wss://official.example'},
    '../storage':{cache:{},tokenStoreFor:()=>tokenStore},
  };
  function load(path:string){const module={exports:{} as any};const source=transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;runInNewContext(source,{module,exports:module.exports,__DEV__:false,globalThis,require:(name:string)=>{if(!(name in mocks))throw new Error(name);return mocks[name];}});return module.exports;}
  const network=load('../src/network/client.ts');mocks['../network/client']=network;
  const {openHost}=load('../src/session/open-host.ts');
  const relay={relay:'wss://official.example',computerId:'A'.repeat(22),computerKey:'A'.repeat(43)};
  const saved={url:'https://synthetic.invalid',serverId:'server',tlsPin:'pin',slot:'saved-slot',relay};
  const client=await openHost(saved);
  assert.equal(client.tokenStore,tokenStore);assert.equal(captured[0].requireAccess,true);
  assert.equal(keyOrigins.length,0);
  const challenge={...relay,serverId:'server',nonce:'A'.repeat(43)};
  const proof=await captured[0].authenticate(challenge);
  assert.deepEqual(proof,signPhoneConnection(challenge,key));
  assert.deepEqual(keyOrigins,['wss://official.example']);
  await assert.rejects(captured[0].authenticate({...challenge,relay:'wss://other.example'}));
  assert.equal(keyOrigins.length,1);
  await openHost({...saved,relay:{...relay,relay:'wss://custom.example'}});
  assert.equal(captured[1].requireAccess,false);assert.equal(typeof captured[1].authenticate,'function');
  await openHost({...saved,relay:{...relay,relay:'wss://custom.example',requireAccess:true}});
  assert.equal(captured[2].requireAccess,true);
});
