// Actual React + Query observers; native store and HTTP payload are synthetic, not device rendering.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {buildSync} from 'esbuild';
import * as Query from '@tanstack/react-query';import * as resources from '../src/ds/preview-resource.ts';import {createPreviewBudget} from '../src/ds/preview-budget.ts';import {loadPrivatePreview} from '../src/ds/preview-load.ts';
import {viewerPreviewActive} from '../src/ds/preview-region.ts';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url)),React=require('react'),{JSDOM}=createRequire(new URL('../../plugin/bridge/fixture/deps/package.json',import.meta.url))('jsdom');
async function fixture(resident=2){
 const dom=new JSDOM('<div id="root"></div>'),beforeWindow=globalThis.window,beforeDocument=globalThis.document;Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=require('react-dom/client'),mount=createRoot(dom.window.document.getElementById('root'));
 const budget=createPreviewBudget({resident,files:resident+2,bytes:(resident+2)*1048576,perFile:1048576,waiters:32,timeout:2000}),client=new Query.QueryClient(),files=new Set<string>(),values=new Map<string,any>(),reads:string[]=[];let nonce=0,allowed=true,readDelay=0;
 const api={createPreviewFile:async()=>{const id='dsbot-preview-10000000-0000-4000-8000-'+String(++nonce).padStart(12,'0')+'.png';files.add(id);return{id,uri:'file:///tmp/'+id}},removePreviewFile:async(id:string)=>{files.delete(id);return true}};
 const mocks:any={react:React,'@tanstack/react-query':Query,'@ds/preview-resource':resources,'@ds/preview-budget':{previewBudget:budget},'@ds/preview-file':{loadPreviewFile:(read:any,options:any)=>loadPrivatePreview(api,read,{...options,budget})},
  'react-native':{View:'div'},'expo-file-system':{File:class{exists=false;parentDirectory={create(){}};writeSync(){assert.fail('Private preview must not persist a shared disk cache')}},Paths:{cache:'file:///cache'}},'expo-image':{Image:'img'},'expo-sharing':{},'expo-media-library':{},'@openbot/team-client/remote-peer':{MOBILE_ATTACHMENT_BYTES:10485760},'heroui-native/hooks':{useThemeColor:()=>''},'lucide-react-native/icons/file-text':{},
  '@/features/analytics/failure-reports':{},'@/shared/lib/haptics':{},'@/shared/lib/text':{useText:()=>({t:(x:string)=>x,sourceText:(x:string)=>x})},'./use-media-file':{},
  '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspaceActions:()=>({canPreviewAttachment:()=>allowed,downloadAttachment:async(_server:string,id:string,{signal}:any)=>{signal?.throwIfAborted();reads.push(id);if(readDelay)await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason)},timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},readDelay);signal?.addEventListener('abort',abort,{once:true})});signal?.throwIfAborted();return{name:'preview.png',mimeType:'image/png',base64:'YWJj',dimensions:{width:10,height:10}}}})},
  '@/features/workspace/model/query-keys':{queryKeys:{chatAttachment:(server:string,id:string)=>['chat-attachment',server,id]}},
 };
 const built=buildSync({absWorkingDir:root,entryPoints:['openbot/mobile/src/features/chat/components/attachment-preview.tsx'],bundle:true,write:false,platform:'node',format:'cjs',external:Object.keys(mocks),jsx:'automatic',logLevel:'silent'}),module={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((name:string)=>name in mocks?mocks[name]:require(name),module,module.exports);
 function Harness({slot,id,active}:{slot:string;id:string;active:boolean}){const value=module.exports.useAttachmentFile('computer',{id,name:'photo.png',size:3,kind:'image',mimeType:'image/png',previewKind:'image',previewUrl:null,downloadMode:'preview'},true,active);values.set(slot,value);return React.createElement('span',null,value.uri??'none');}
 const render=async(items:Array<{slot:string;id:string;active:boolean}>)=>{await React.act(async()=>{mount.render(React.createElement(Query.QueryClientProvider,{client},items.map(item=>React.createElement(Harness,{...item,key:item.slot}))));await new Promise(r=>setTimeout(r,20));});};
 const until=async(check:()=>boolean)=>{const end=Date.now()+3000;while(!check()&&Date.now()<end)await React.act(async()=>{await new Promise(r=>setTimeout(r,20))});assert.ok(check(),'observer state did not settle');};
 return{render,until,files,client,budget,values,reads,get created(){return nonce},delay:(ms:number)=>{readDelay=ms},revoke:()=>{allowed=false},close:async()=>{await React.act(async()=>{mount.unmount();client.clear();await new Promise(r=>setTimeout(r,10))});dom.window.close();Object.assign(globalThis,{window:beforeWindow,document:beforeDocument});}};
}
test('card and viewer share one resource; inactive observers really detach and release after the last committed image leaves',async t=>{
 const f=await fixture();t.after(f.close);const card={slot:'card',id:'image-A',active:true},viewer={slot:'viewer',id:'image-A',active:true};await f.render([card,viewer]);await f.until(()=>f.files.size===1&&!!f.values.get('viewer')?.uri);assert.equal(f.reads.length,1);
 await f.render([{...card,active:false},viewer]);assert.equal(f.values.get('card').uri,null);assert.equal(f.files.size,1);assert.equal(f.client.getQueryCache().getAll()[0].getObserversCount(),1);
 await f.render([{...card,active:false},{...viewer,active:false}]);await f.until(()=>f.files.size===0);assert.equal(f.client.getQueryCache().getAll().reduce((n,q)=>n+q.getObserversCount(),0),0);assert.equal(f.budget.used,0);
});
test('full refresh preserves a shown resource until commit, and grant loss hides and releases all cached images',async t=>{
 const f=await fixture();t.after(f.close);const items=[{slot:'a',id:'image-A',active:true},{slot:'b',id:'image-B',active:true}];await f.render(items);await f.until(()=>f.files.size===2&&!!f.values.get('a')?.uri);const old=f.values.get('a').uri;
 await React.act(async()=>{await f.values.get('a').query.refetch();});await f.until(()=>f.values.get('a').uri!==old);assert.equal(f.budget.used,2);assert.equal(f.files.size,2);
 f.revoke();await f.render(items);await f.until(()=>f.files.size===0);assert.equal(f.values.get('a').uri,null);assert.equal(f.values.get('b').uri,null);assert.equal(f.budget.used,0);
});

test('opening and rapidly paging a viewer shares the current card and retains only three adjacent pages',async t=>{
 const f=await fixture(4);t.after(f.close);
 const pages=(shown:number)=>[{slot:'card',id:'image-0',active:shown===0},...Array.from({length:12},(_,i)=>({slot:'page-'+i,id:'image-'+i,active:viewerPreviewActive(i,shown)}))];
 await f.render(pages(0));await f.until(()=>f.files.size===2);assert.equal(f.reads.length,2);
 for(const shown of [1,5,8,2,7])await f.render(pages(shown));await f.until(()=>f.files.size===3&&!!f.values.get('page-7')?.uri);assert.equal(f.values.get('card').uri,null);assert.equal(f.budget.waiting,0);assert.equal(f.budget.used,3);
 await f.render([]);await f.until(()=>f.files.size===0);assert.equal(f.budget.used,0);
});

test('fast scrolling cancels queued and in-flight reads before an offscreen native file can be created',async t=>{
 const f=await fixture(3);t.after(f.close);f.delay(100);
 const pages=(start:number)=>Array.from({length:12},(_,i)=>({slot:'card-'+i,id:'image-'+i,active:i>=start&&i<start+3}));
 await f.render(pages(0));await f.render(pages(7));await f.until(()=>f.files.size===3&&!!f.values.get('card-7')?.uri);assert.equal(f.created,3);assert.equal(f.budget.waiting,0);assert.equal(f.values.get('card-0').uri,null);
 await f.render([]);await f.until(()=>f.files.size===0);assert.equal(f.budget.used,0);
});
