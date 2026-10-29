import test from 'node:test';
import { createDsWorkspaceCoordinator } from '../src/ds/workspace.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';
import { conversationStreams } from '../src/logic/conversation-streams.ts';
import { outgoingMessage, recoveredIntent } from '../src/logic/outgoing.ts';
import * as access from '../src/logic/mobile-access.ts';
import { MobileClient, MemoryTokenStore } from '../sdk/index.js';

const require = createRequire(import.meta.url), ts = require('typescript');
const deferred = () => { let resolve!: (value?: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return {promise,resolve}; };
function hookRuntime(file: string, mocks: Record<string, unknown>) {
  const slots: any[] = [], effects: Array<() => void> = [];
  let cursor = 0, dirty = false, args: any[] = [], result: any;
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value: any) => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial: any) { return slots[cursor++] ||= {current:initial}; },
    useCallback(callback: any, deps: any[]) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = {deps,callback}; return slots[i].callback; },
    useEffect(effect: () => any, deps: any[]) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = {deps,cleanup:effect()}; }); },
  };
  const module = {exports:{} as any};
  const source = readFileSync(new URL(`../src/hooks/${file}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  runInNewContext(compiled, {module,exports:module.exports,AbortController,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    require(name: string) { if (name === 'react') return react; if (name === '../ds/workspace.ts') return {createDsWorkspaceCoordinator}; if (name in mocks) return mocks[name]; throw Error(name); },
  });
  function render(...next: any[]) { if (next.length) args = next; cursor = 0; dirty = false; result = module.exports[file](...args); return result; }
  return {render, value:()=>result,
    async flush() { for (let i=0;i<30;i++) { for (const effect of effects.splice(0)) effect(); await Promise.resolve(); if (dirty) render(); } },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const native = {AppState:{currentState:'active',addEventListener:()=>({remove(){}})}};
function chatFixture(capabilities: any) {
  let reads = 0, streams = 0, writes = 0;
  const client = {
    messages:async()=>{reads++;return {messages:[],cursor:null};},
    connect:()=>{streams++;return {close(){streams--;}};},
  };
  const runtime = hookRuntime('useConversation', {
    'react-native':native,'expo-crypto':{randomUUID:()=> 'test-request'},'@ds-bot/mobile-sdk':{mergeMessages:(a:any[],b:any[])=>[...a,...b]},
    '../storage':{readCache:async()=>null,writeCache:async()=>{},writeSendCache:async()=>{writes++;return true;},tokenStoreFor:()=>({get:async()=>null}),cache:{getMessages:async()=>[],getDraft:async()=> 'kept draft',setDraft:async()=>{writes++;}}},
    '../types':{errorText:String},'../logic/submissions':{},'../logic/mobile-access':access,'../logic/outgoing':{outgoingMessage,recoveredIntent},
    '../logic/conversation-streams':{conversationStreams},'../components/ScreenActivity':{useScreenActivity:()=>true},
  });
  const host = {serverId:'contract-fixture',slot:'fixture-slot'};
  runtime.render(client,host,'bot:a',capabilities);
  return {...runtime, capabilities(value:any){runtime.render(client,host,'bot:a',value);},stats:()=>({reads,streams,writes}),
    dispose(){runtime.dispose();conversationStreams.clear(client as any);}};
}

test('unknown or explicitly denied text capabilities never open REST history, WS or an outgoing send', async () => {
  for (const capabilities of [undefined, {}, {history:false,stream:false,send:false}, {history:'true',stream:1,send:'true'}]) {
    const chat = chatFixture(capabilities);
    try {
      await chat.flush();
      assert.deepEqual(chat.stats(), {reads:0,streams:0,writes:0});
      assert.equal(chat.value().beginSend(), null);
      await chat.flush();
      assert.equal(chat.value().draft, 'kept draft');
      assert.equal(chat.stats().writes, 0);
    } finally { chat.dispose(); }
  }
});

test('history and stream grants are independent and capability revocation closes retained streams', async () => {
  const chat = chatFixture({history:true,stream:false,send:false});
  try {
    await chat.flush();
    assert.deepEqual(chat.stats(), {reads:1,streams:0,writes:0});
    chat.capabilities({history:false,stream:true,send:false}); await chat.flush();
    assert.deepEqual(chat.stats(), {reads:1,streams:1,writes:0});
    chat.capabilities({}); await chat.flush();
    assert.deepEqual(chat.stats(), {reads:1,streams:0,writes:0});
    chat.capabilities({history:true,stream:true,send:true}); await chat.flush();
    assert.deepEqual(chat.stats(), {reads:2,streams:1,writes:0});
  } finally { chat.dispose(); }
});

test('cached capabilities never authorize a fresh connection and a new handshake restores supported operations', async () => {
  const ready = deferred();
  const cached = {bots:[{id:'old'}],rooms:[],models:[],mobileCapabilities:{send:true,history:true,stream:true,actions:['create-bot']}};
  const client = {state:async()=>({bots:[],rooms:[],models:[]}),conversations:async()=>({conversations:[]}),info:async()=>{await ready.promise;return {serverId:'fixture',capabilities:{send:true,history:true,stream:true,actions:['create-bot']}};}};
  const runtime = hookRuntime('useWorkspace', {'react-native':native,
    '../storage':{readCache:async(_server:string,key:string)=>key==='team'?cached:[],writeCache:async()=>{}},
    '../types':{teamState:(v:any)=>v,errorText:String},
  });
  try {
    runtime.render(client,{serverId:'fixture'}); await runtime.flush();
    assert.equal(access.mobileActionAllowed(runtime.value().team.mobileCapabilities,'create-bot'), false);
    assert.equal(runtime.value().team.mobileCapabilities?.send === true, false);
    ready.resolve(); await runtime.flush();
    assert.equal(access.mobileActionAllowed(runtime.value().team.mobileCapabilities,'create-bot'), true);
    const waiting = deferred(), other = {...client,info:()=>waiting.promise};
    const next = runtime.render(other,{serverId:'other'});
    assert.equal(access.mobileActionAllowed(next.team.mobileCapabilities,'create-bot'), false, 'new client cannot borrow previous render capabilities');
    assert.equal(next.online, false);
  } finally { runtime.dispose(); }
});

test('paired credential stores stay bound to their URL even when two computers advertise the same public serverId', async () => {
  const original = {accessToken:'fixture-access',refreshToken:'fixture-refresh',serverId:'shared-id',deviceId:'device',expiresAt:Date.now()+60000,serverUrl:'https://old.example'};
  let credentialRequests = 0;
  const store = new MemoryTokenStore(original);
  const client = new MobileClient({baseUrl:'https://new.example',tokenStore:store,fetch:async(_url:any,init:any)=>{
    if (init.headers.Authorization || init.body?.includes('fixture-refresh')) credentialRequests++;
    return new Response(JSON.stringify({protocolVersion:1,serverId:'shared-id'}),{status:200});
  }});
  try { await assert.rejects(client.state(),{code:'server_changed'}); assert.equal(credentialRequests,0); assert.deepEqual(await store.get(), original); }
  finally {client.dispose();}
});

test('a late cache read cannot replace a successful live snapshot or strip its verified capabilities', async () => {
  const cached = deferred();
  const fresh = {bots:[{id:'fresh'}],rooms:[],models:[]};
  const client = {state:async()=>fresh,conversations:async()=>({conversations:[{id:'fresh'}]}),info:async()=>({serverId:'fixture',capabilities:{send:true,actions:['create-bot']}})};
  const runtime = hookRuntime('useWorkspace', {'react-native':native,
    '../storage':{readCache:()=>cached.promise,writeCache:async()=>{}},'../types':{teamState:(v:any)=>v,errorText:String},
  });
  try {
    runtime.render(client,{serverId:'fixture'}); await runtime.flush();
    await runtime.value().refresh(); await runtime.flush();
    assert.equal(runtime.value().team.bots[0].id,'fresh');
    cached.resolve({bots:[{id:'cached'}],rooms:[],models:[]}); await runtime.flush();
    assert.equal(runtime.value().team.bots[0].id,'fresh');
    assert.equal(access.mobileActionAllowed(runtime.value().team.mobileCapabilities,'create-bot'),true);
    assert.equal(runtime.value().conversations[0].id,'fresh');
  } finally {runtime.dispose();}
});

test('a refresh after creating something waits out a running poll and returns the new conversation', async () => {
  const held = deferred();
  let lists = 0, created = false;
  const client = {state:async()=>({bots:[],rooms:[],models:[]}),info:async()=>({serverId:'fixture',capabilities:{}}),
    conversations:async()=>{ lists++; if (lists === 2) await held.promise; return {conversations:created ? [{id:'agent:a:s1'}] : []}; }};
  const runtime = hookRuntime('useWorkspace', {'react-native':native,
    '../storage':{readCache:async()=>null,writeCache:async()=>{}},'../types':{teamState:(v:any)=>v,errorText:String},
  });
  try {
    runtime.render(client,{serverId:'fixture'}); await runtime.flush();
    const poll = runtime.value().refresh();          // an in-flight poll that predates the creation
    created = true;
    const quick = runtime.value().refresh();         // a plain call still joins the poll
    const fresh = runtime.value().refresh({fresh:true});
    held.resolve(); await Promise.all([poll, quick, fresh]); await runtime.flush();
    assert.equal(lists, 3);
    assert.deepEqual(runtime.value().conversations.map((item:any)=>item.id), ['agent:a:s1']);
  } finally {runtime.dispose();}
});

test('workspace refresh returns a canonical snapshot before React rerender and old hosts cannot return it', async () => {
  const client={state:async()=>({bots:[{id:'live',name:'Live'}],rooms:[],models:[]}),conversations:async()=>({conversations:[]}),info:async()=>({serverId:'fixture',capabilities:{send:true}})};
  const runtime=hookRuntime('useWorkspace',{'react-native':native,'../storage':{readCache:async()=>null,writeCache:async()=>{}},'../types':{teamState:(v:any)=>v,errorText:String}});
  try {
    runtime.render(client,{serverId:'fixture'});await runtime.flush();
    const oldRefresh=runtime.value().refreshSnapshot;
    const canonical=await oldRefresh({fresh:true});assert.equal(canonical?.team.bots[0].id,'live');assert.equal(runtime.value().getSnapshot(),canonical);
    const other={...client};runtime.render(other,{serverId:'other'});
    assert.equal(runtime.value().getSnapshot(),null);assert.equal(await oldRefresh({fresh:true}),undefined);
  }finally{runtime.dispose();}
});
