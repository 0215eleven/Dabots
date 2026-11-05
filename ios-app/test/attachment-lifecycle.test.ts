import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
function load(entry:string,mocks:Record<string,any>={}){const result=buildSync({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',external:Object.keys(mocks),supported:{'dynamic-import':false},logLevel:'silent'}),module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)((name:string)=>Object.hasOwn(mocks,name)?mocks[name]:require(name),module,module.exports);return module.exports;}
function hooks(){let cursor=0;const slots:any[]=[],effects:any[]=[];const same=(a:any[],b:any[])=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));const react={
 useState:(initial:any)=>{const n=cursor++;slots[n]??={value:typeof initial==='function'?initial():initial};return[slots[n].value,(value:any)=>{slots[n].value=typeof value==='function'?value(slots[n].value):value}]},
 useRef:(initial:any)=>{const n=cursor++;return slots[n]??={current:initial}},useMemo:(fn:any,deps:any[])=>{const n=cursor++;if(!same(slots[n]?.deps,deps))slots[n]={value:fn(),deps};return slots[n].value},
 useEffect:(effect:any,deps:any[])=>{const n=cursor++;if(same(slots[n]?.deps,deps))return;const old=slots[n];slots[n]={deps};effects.push(()=>{old?.cleanup?.();slots[n].cleanup=effect()})},
 };return{react,render:(fn:any)=>{cursor=0;const value=fn();while(effects.length)effects.shift()();return value},unmount:()=>slots.forEach(value=>value?.cleanup?.())};}
const textFor=load('openbot/mobile/src/shared/lib/text-value.ts').textFor;
const logic=load('src/logic/upload-attachments.ts'),selectionError=load('src/ds/attachment-selection-error.ts').selectionErrorMessage;

test('upload transport failures are localized without exposing raw server errors',()=>{
 const {uploadErrorMessage}=load('src/ds/attachment-selection-error.ts'),text=textFor('zh');
 for(const code of ['unsupported_upload','UPLOAD_QUOTA','TARGET_CHANGED','cancelled','upload_protocol','network_error']){
  const message=uploadErrorMessage({code,message:'raw server error'},text);assert.ok(message);assert.ok(!message.includes('raw server error'));assert.ok(/[\u4e00-\u9fff]/u.test(message));
 }
});
test('real attachment failure path renders Chinese type errors and the actual 100 MB threshold',async()=>{
 const h=hooks(),text=textFor('zh'),alerts:any[]=[],representation:any[]=[],discarded:any[]=[];let size=3,name='unsupported.exe';
 const mocks:any={react:h.react,'react-native':{Platform:{OS:'ios'}},'expo-file-system':{File:class{constructor(){assert.fail('URI-backed selection must not be loaded as full base64')}}},
  'expo-document-picker':{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'file:///granted/source',name}]})},
  'expo-image-picker':{UIImagePickerPreferredAssetRepresentationMode:{Current:'current',Compatible:'compatible'},launchImageLibraryAsync:async(options:any)=>{representation.push(options);return{canceled:true}}},
  '@/shared/lib/text':{useText:()=>text},'@/features/analytics/events':{attachmentSizeBucket:()=>''},'@/features/analytics/mobile-analytics':{mobileAnalytics:{track(){}}},
  '@/features/analytics/failure-reports':{showFailureAlert:(...args:any[])=>alerts.push(args)},'@/shared/lib/haptics':{haptics:{notification:async()=>{}}},'@/shared/lib/read-file-base64':{readFileBase64:()=>assert.fail('no whole-file read')},
 };
 const {useChatAttachments}=load('openbot/mobile/src/features/chat/components/use-chat-attachments.ts',mocks);
 const render=()=>h.render(()=>useChatAttachments([],async(items:any[])=>{try{logic.validateSelectedUploads(items)}catch(error){throw Error(selectionError(error,text))}},undefined,{
  bytes:100000000,count:4,file:async()=>({uri:'file:///cache/DabotsUploadDrafts/owned.txt',name,mediaType:'text/plain',size,clientId:'owned',kind:'file',owned:true}),discardFile:(file:any)=>discarded.push(file),
 }));
 await render().chooseFiles();assert.match(alerts[0][3],/请选择/);assert.ok(!alerts[0][3].includes('Choose'));
 name='large.txt';size=100000001;await render().chooseFiles();assert.match(alerts[1][3],/100 MB/);assert.ok(!alerts[1][3].includes('10 MB'));
 await render().choosePhotos();assert.equal(representation[0].preferredAssetRepresentationMode,'current');assert.equal(representation[0].quality,1);assert.equal(discarded.length,2);h.unmount();
});
function dsFixture(){
 const h=hooks(),text=textFor('en'),deleted:string[]=[],removed:string[]=[],sources:any[]=[];let items:any[]=[],policy:any={uploadTransfers:1},limits:any,nonce=0,sessionId='s',copyGate:Promise<void>|undefined;
 const makeSource=(uri:string,name:string)=>({uri:'file:///cache/DabotsUploadDrafts/'+(++nonce)+'.txt',name,mediaType:'text/plain',size:3,clientId:'source_'+nonce,kind:'file',owned:true});
 const mockBase=(_items:any,persist:any,_support:any,options:any)=>{limits=options;return{items,preparing:false,clear:()=>{items=[]},remove:(id:string)=>{items=items.filter(item=>item.id!==id)},restore:(files:any[])=>{items.push(...files)}}};
 const mocks:any={react:h.react,'react-native-reanimated':{useSharedValue:()=>({value:0})},'expo-file-system':{Paths:{cache:{uri:'file:///cache/'}},File:class{uri:string;constructor(uri:string){this.uri=uri}delete(){deleted.push(this.uri)}}},
  '@/features/chat/components/use-chat-attachments':{useChatAttachments:mockBase},'@/shared/lib/text':{useText:()=>text},'../session/SessionProvider':{useSession:()=>({host:{serverId:'server'},client,workspace:{online:true,conversations:[{id:'bot',sessionId}],team:{mobileCapabilities:policy}}})},
  './attachment-files':{copyDraftUpload:async(uri:string,name:string)=>{await copyGate;const value=makeSource(uri,name);sources.push(value);return value},discardDraftUpload:(source:any)=>deleted.push(source.uri),readCachedChunk:async()=>new Uint8Array([97,98,99]),createUploadId:()=>`inline_${++nonce}`},
  './prepare-photo':{prepareSelectedPhoto:()=>assert.fail('document test')},
 };
 const {useAttachments}=load('src/ds/use-attachments.ts',mocks),render=()=>h.render(()=>useAttachments('bot'));
 const client:any={target:async()=>({sessionId}),removeTransfer:async(id:string)=>{removed.push(id)},uploadFile:async(options:any)=>{options.onTransfer?.('receipt_'+options.clientId);options.onProgress?.(3,3);return{receiptId:'receipt_'+options.clientId,name:options.name,size:3}}};
 return{h,render,client,deleted,removed,sources,get limits(){return limits},setSession:(value:string)=>{sessionId=value},delayCopy:(gate:Promise<void>)=>{copyGate=gate},setPolicy:(value:any)=>{policy=value},add:async()=>{render();const source=await limits.file('file:///user/original.txt','source.txt');items.push({id:source.clientId,name:source.name,mimeType:'text/plain',base64:'',size:3,localFile:source});return source},replace:async()=>{const old=items[0],source=await limits.file('file:///user/next.txt','next.txt');items=[{...old,id:source.clientId,name:source.name,localFile:source}];return source}};
}

test('session replacement during selection or before upload cannot deliver the draft into a new Session',async()=>{
 const f=dsFixture();let resume!:()=>void;f.delayCopy(new Promise<void>(resolve=>{resume=resolve}));const pending=f.add();await new Promise(resolve=>setImmediate(resolve));f.setSession('s2');f.render();resume();await assert.rejects(pending);assert.ok(f.deleted.includes(f.sources[0].uri));
 const g=dsFixture();await g.add();const old=g.render();g.setSession('s2');g.render();await assert.rejects(old.upload(g.client,'bot'));assert.deepEqual(g.removed,[]);g.h.unmount();f.h.unmount();
});
test('old desktop/relay capabilities retain legacy selection limits and do not enable URI uploads',()=>{
 const f=dsFixture();f.setPolicy({attachments:true});f.render();assert.equal(f.limits.bytes,2097152);assert.equal(f.limits.file,undefined);
 f.setPolicy({uploadTransfers:1});f.render();assert.equal(f.limits.bytes,100000000);assert.equal(typeof f.limits.file,'function');f.h.unmount();
});

test('document replacements rejected by persistence or cleared during copying release the newly owned copy',async()=>{
 const h=hooks(),text=textFor('en'),deleted:any[]=[],initial={id:'old',name:'old.txt',mimeType:'text/plain',base64:'',size:1};let rejectSave=false,release:(()=>void)|undefined,gate:Promise<void>|undefined;
 const mocks:any={react:h.react,'react-native':{Platform:{OS:'ios'}},'expo-file-system':{},'expo-image-picker':{},
  'expo-document-picker':{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'file:///provider/new.txt',name:'new.txt'}]})},
  '@/shared/lib/text':{useText:()=>text},'@/features/analytics/events':{attachmentSizeBucket:()=>''},'@/features/analytics/mobile-analytics':{mobileAnalytics:{track(){}}},
  '@/features/analytics/failure-reports':{showFailureAlert:()=>{}},'@/shared/lib/haptics':{haptics:{notification:async()=>{}}},'@/shared/lib/read-file-base64':{readFileBase64:()=>assert.fail('no base64')},
 };
 const {useChatAttachments}=load('openbot/mobile/src/features/chat/components/use-chat-attachments.ts',mocks);
 const source={uri:'file:///cache/DabotsUploadDrafts/new.txt',name:'new.txt',mediaType:'text/plain',size:2,clientId:'new',kind:'file',owned:true};
 const render=()=>h.render(()=>useChatAttachments([initial],async()=>{if(rejectSave)throw Error('aggregate size exceeded')},undefined,{bytes:100000000,count:4,file:async()=>{await gate;return source},discardFile:(file:any)=>deleted.push(file)}));
 rejectSave=true;await render().replace('old');assert.deepEqual(deleted,[source]);assert.equal(render().items[0].id,'old');
 deleted.length=0;rejectSave=false;gate=new Promise<void>(resolve=>{release=resolve});const replacement=render().replace('old');await new Promise(resolve=>setImmediate(resolve));render().clear();assert.equal(render().items.length,0);release!();await replacement;assert.deepEqual(deleted,[source]);h.unmount();
});
test('restore de-duplicates owned sources; replacement, removal, clear and unmount clean only App copies',async()=>{
 const f=dsFixture(),first=await f.add();let value=f.render();value.restore(value.items);assert.equal(f.render().items.length,1);
 const second=await f.replace();value=f.render();assert.ok(f.deleted.includes(first.uri));assert.ok(!f.deleted.includes(second.uri));
 value.remove(value.items[0].id);f.render();assert.ok(f.deleted.includes(second.uri));
 const third=await f.add();value=f.render();value.clear();f.render();assert.ok(f.deleted.includes(third.uri));
 const fourth=await f.add();f.render();f.h.unmount();assert.ok(f.deleted.includes(fourth.uri));assert.ok(f.deleted.every(uri=>uri.startsWith('file:///cache/')));
});
test('clearing a queued composer preserves receiver receipts, while abandoning an upload removes them',async()=>{
 const f=dsFixture();await f.add();let value=f.render();await value.upload(f.client,'bot');value=f.render();value.clearSent();f.render();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.removed,[]);
 await f.add();value=f.render();await value.upload(f.client,'bot');value=f.render();value.clear();f.render();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.removed.length,1);f.h.unmount();
});
