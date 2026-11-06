// Actual JS network adapter, mocked OS transport only. No user profile, files or remote service.
import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import * as sdk from '../sdk/index.js';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),pin='sha256:'+'a'.repeat(64),image=Buffer.alloc(343000,73);
function fixture({relay=false,size=image.length,mime='Image/PNG; charset=binary',cancelRead=false,failRemoval=0,fileUri='file:///private/response'}:{relay?:boolean;size?:number;mime?:string;cancelRead?:boolean;failRemoval?:number;fileUri?:string}={}){
 let reads=0,removed=0,requests:any[]=[],controller=new AbortController();
 const native={request:async(input:any)=>{requests.push(input);return String(input.url).endsWith('/info')?{status:200,headers:{},bodyText:JSON.stringify({protocolVersion:1,serverId:'synthetic-host'})}:{status:200,headers:{'content-type':mime},bodyFile:fileUri,fileId:'dsbot-response-10000000-0000-4000-8000-000000000001'}},removeResponseFile:async()=>++removed>failRemoval,cancel:async()=>{},addListener:()=>({remove(){}})};
 const mocks:any={expo:{requireOptionalNativeModule:()=>native},'react-native':{Platform:{OS:'ios'}},'expo-crypto':{getRandomBytes:(n:number)=>new Uint8Array(n)},
  'expo-file-system':{File:class{size=size;async base64(){reads++;if(cancelRead)controller.abort();return image.toString('base64')}}},
  '../storage/relay-key':{relayPhoneKey:()=>assert.fail('no server auth requested')},'../logic/relay-access':{},'../logic/pairing':{relayOrigin:(s:string)=>s},'../logic/hosts':{officialRelay:()=>null},
  '@ds-bot/mobile-sdk':sdk,'@ds-bot/mobile-sdk/relay-transport':{createRelayTransport:()=>({baseUrl:'https://synthetic-relay.example',WebSocket:class{},dispose(){},fetch:async(url:any,init:any)=>{
   requests.push({url,headers:init.headers});return String(url).endsWith('/info')?Response.json({protocolVersion:1,serverId:'synthetic-host'}):{status:200,ok:true,headers:new Headers({'content-type':mime}),arrayBuffer:async()=>{reads++;return image.buffer.slice(image.byteOffset,image.byteOffset+image.length)}};
  }})},
 };
 const result=buildSync({absWorkingDir:root,entryPoints:['src/network/client.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:Object.keys(mocks),logLevel:'silent'}),module={exports:{} as any};
 new Function('require','module','exports',result.outputFiles[0].text)((name:string)=>Object.hasOwn(mocks,name)?mocks[name]:require(name),module,module.exports);
 const client=module.exports.createMobileClient({baseUrl:'https://synthetic-host.example',...(!relay?{tlsPin:pin}:{}),tokenStore:new sdk.MemoryTokenStore({accessToken:'synthetic-only',refreshToken:'synthetic-refresh',serverId:'synthetic-host',deviceId:'synthetic',expiresAt:Date.now()+3600000,...(!relay?{tlsPin:pin}:{} )}),...(relay?{relay:{relay:'wss://synthetic-relay.example',computerId:'fixture',computerKey:'fixture',serverId:'synthetic-host'}}:{})});
 return{client,controller,get reads(){return reads},get removed(){return removed},get requests(){return requests}};
}
test('local TLS file crosses JS as a bounded plain value and is removed exactly once',async t=>{
 const f=fixture();t.after(()=>f.client.dispose());const data=await f.client.attachmentData('conversation','session','hash',{seq:3});assert.equal(data.mimeType,'image/png');assert.deepEqual(Buffer.from(data.base64,'base64'),image);assert.equal(f.reads,1);assert.equal(f.removed,1);assert.ok(f.requests[1].url.includes('seq=3'));assert.match(f.requests[1].headers.authorization,/^Bearer /);
});
test('invalid MIME, oversized files and cancellation release native response files without unsafe reads',async t=>{
 for(const [options,code,reads] of [[{mime:'text/html'},'preview_mime',0],[{size:100000000},'preview_size',0],[{cancelRead:true},'cancelled',1]] as const){const f=fixture(options);t.after(()=>f.client.dispose());await assert.rejects(f.client.attachmentData('conversation','session','hash',{seq:3,signal:f.controller.signal}),{code});assert.equal(f.removed,1);assert.equal(f.reads,reads);}
});
test('native encrypted relay adapter supplies the same plain bytes without constructing any Blob',async t=>{
 const f=fixture({relay:true});t.after(()=>f.client.dispose());const data=await f.client.attachmentData('conversation','session','hash',{seq:7});assert.equal(data.mimeType,'image/png');assert.deepEqual(Buffer.from(data.base64,'base64'),image);assert.equal(f.reads,1);assert.ok(f.requests[1].url.includes('seq=7'));
});

test('a failed response-file removal is retried instead of falsely acknowledged',async t=>{
 const f=fixture({failRemoval:1});t.after(()=>f.client.dispose());const data=await f.client.attachmentData('conversation','session','hash',{seq:3});assert.equal(Buffer.from(data.base64,'base64').length,image.length);assert.equal(f.removed,2);
});

test('old Android file:/ URIs normalize locally; external or parameterized paths cannot be read',async t=>{
 const f=fixture({fileUri:'file:/private/response'});t.after(()=>f.client.dispose());assert.ok((await f.client.attachmentData('conversation','session','hash',{seq:3})).base64);assert.equal(f.reads,1);
 for(const fileUri of ['https://outside.invalid/photo','file://outside/private/photo','file:///private/response?token=synthetic']){const g=fixture({fileUri});t.after(()=>g.client.dispose());await assert.rejects(g.client.attachmentData('conversation','session','hash',{seq:3}),{code:'preview_read'});assert.equal(g.reads,0);assert.equal(g.removed,1);}
});
