// Actual list/range/gallery/query integration with synthetic native scroll and file APIs.
// This establishes admission and cleanup, not iPhone rendering or performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import * as Query from '@tanstack/react-query';
import * as resources from '../src/ds/preview-resource.ts';
import {createPreviewBudget} from '../src/ds/preview-budget.ts';
import {loadPrivatePreview} from '../src/ds/preview-load.ts';

const require=createRequire(import.meta.url),React=require('react');
const {JSDOM}=createRequire(new URL('../../plugin/bridge/fixture/deps/package.json',import.meta.url))('jsdom');

test('scrolling inside a tall message updates actual gallery subscriptions when row viewability is unchanged',async t=>{
 const dom=new JSDOM('<div id="root"></div>'),before={window:globalThis.window,document:globalThis.document};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const mount=require('react-dom/client').createRoot(dom.window.document.getElementById('root'));
 const budget=createPreviewBudget({resident:2,files:4,bytes:4*1048576,perFile:1048576,waiters:32,timeout:2000});
 const client=new Query.QueryClient(),files=new Set<string>(),reads:string[]=[];
 let sequence=0,scrollY=0,measurements=0,list:any,amountCalls=0,forwarded=0;
 const api={createPreviewFile:async()=>{const id=`dsbot-preview-10000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}.png`;files.add(id);return{id,uri:'file:///tmp/'+id}},removePreviewFile:async(id:string)=>{files.delete(id);return true}};
 // The fixed amount token reproduces Legend List 3.7's tall-row suppression:
 // 600 visible pixels in a 2000px message, at every intermediate scroll offset.
 const token={isViewable:true,sizeVisible:600,percentVisible:30,percentOfScroller:100};
 const mocks:any={react:React,'@tanstack/react-query':Query,'@ds/preview-resource':resources,'@ds/preview-budget':{previewBudget:budget},
  '@ds/preview-file':{loadPreviewFile:(read:any,options:any)=>loadPrivatePreview(api,read,{...options,budget})},
  '@legendapp/list/keyboard':{KeyboardAwareLegendList:(props:any)=>{list=props;return props.data.map((item:any,index:number)=>props.renderItem({item,index}));}},
  '@legendapp/list/react-native':{useViewabilityAmount:(callback:any)=>{React.useLayoutEffect(()=>{amountCalls++;callback(token)},[callback])}},
  'react-native':{View:'div',Pressable:({children}:any)=>React.createElement('button',null,children),useWindowDimensions:()=>({width:400,height:600})},
  'react-native-reanimated':{__esModule:true,default:{View:({ref:origin,children,...props}:any)=>{React.useImperativeHandle(origin,()=>({measureInWindow:(done:any)=>{measurements++;done(0,props.style[0].top-scrollY,props.style[0].width,props.style[0].height)}}),[origin,props.style[0].top]);return React.createElement('div',null,children)}}},
  'expo-image':{Image:({source}:any)=>React.createElement('img',{'data-uri':source??''})},
  'expo-file-system':{File:class{},Paths:{}},'expo-sharing':{},'expo-media-library':{},
  '@openbot/team-client/remote-peer':{MOBILE_ATTACHMENT_BYTES:10485760},
  'heroui-native':{Skeleton:()=>null},'heroui-native/hooks':{useThemeColor:()=>''},'lucide-react-native/icons/image-off':{__esModule:true,default:()=>null},'lucide-react-native/icons/file-text':{},
  '@/features/chat/components/use-history-shown':{useHistoryShown:()=>true},
  './chat-image-viewer':{useChatImageSource:()=>({origin:React.useRef(null),previewActive:true,hiddenStyle:{}})},
  '@/features/analytics/failure-reports':{},'@/shared/lib/haptics':{},'@/shared/lib/text':{useText:()=>({t:(x:string)=>x,sourceText:(x:string)=>x})},'./use-media-file':{},
  '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspaceActions:()=>({canPreviewAttachment:()=>true,downloadAttachment:async(_server:string,id:string)=>{reads.push(id);return{name:'preview.png',mimeType:'image/png',base64:'YWJj',dimensions:{width:10,height:10}}}})},
  '@/features/workspace/model/query-keys':{queryKeys:{chatAttachment:(server:string,id:string)=>['chat-attachment',server,id]}},
 };
 // Force a large gallery across the message so that only two of its images fit at once.
 mocks['../model/image-gallery-layout']={galleryTiles:(count:number)=>({height:2000,tiles:Array.from({length:count},(_,i)=>({left:0,top:i*300,width:100,height:200}))})};
 const root=fileURLToPath(new URL('../',import.meta.url));
 const built=buildSync({absWorkingDir:root,stdin:{contents:`export {ChatPreviewList} from './src/ds/preview-list';export {ChatPreviewRange} from './src/ds/preview-range';export {ChatImageGallery} from './openbot/mobile/src/features/chat/components/chat-image-gallery';`,resolveDir:root},alias:{'@ds/preview-range':root+'src/ds/preview-range.tsx'},bundle:true,write:false,platform:'node',format:'cjs',external:Object.keys(mocks),jsx:'automatic',logLevel:'silent'});
 const module={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)((name:string)=>name in mocks?mocks[name]:require(name),module,module.exports);
 const {ChatPreviewList,ChatPreviewRange,ChatImageGallery}=module.exports;
 const attachments=Array.from({length:7},(_,i)=>({id:'image-'+i,name:'preview.png',size:3,kind:'image',mimeType:'image/png',previewKind:'image',previewUrl:null,downloadMode:'preview'}));
 const render=async()=>{await React.act(async()=>{mount.render(React.createElement(Query.QueryClientProvider,{client},React.createElement(ChatPreviewList,{data:['tall-message'],onScroll:()=>{forwarded++},renderItem:()=>React.createElement(ChatPreviewRange,{key:'row'},React.createElement(ChatImageGallery,{serverId:'computer',attachments}))})));});};
 const settle=async(check:()=>boolean)=>{const end=Date.now()+3000;while(!check()&&Date.now()<end)await React.act(async()=>{await new Promise(r=>setTimeout(r,20))});assert.ok(check(),'scroll admission did not settle')};
 const observed=()=>client.getQueryCache().getAll().filter(query=>query.getObserversCount()>0).map(query=>query.queryKey[2]).sort();
 t.after(async()=>{await React.act(async()=>{mount.unmount();client.clear();await new Promise(r=>setTimeout(r,80))});assert.equal(files.size,0);assert.equal(budget.used,0);assert.equal(budget.waiting,0);dom.window.close();Object.assign(globalThis,before)});
 await render();await settle(()=>files.size===2);assert.deepEqual(observed(),['image-0','image-1']);assert.equal(amountCalls,1);
 const baseline=measurements;
 // These are native list scroll events, with no rerender, layout event, or viewability callback.
 scrollY=900;await React.act(async()=>{for(let i=0;i<20;i++)list.onScroll({nativeEvent:{contentOffset:{y:scrollY}}})});
 await settle(()=>observed().join(',')==='image-3,image-4'&&files.size===2&&reads.includes('image-4'));
 assert.equal(amountCalls,1);assert.equal(forwarded,20);assert.equal(measurements-baseline,7);assert.equal(budget.used,2);
 scrollY=1500;list.onScroll({nativeEvent:{contentOffset:{y:scrollY}}});
 await settle(()=>observed().join(',')==='image-5,image-6'&&files.size===2&&reads.includes('image-6'));
 assert.equal(amountCalls,1);assert.equal(budget.waiting,0);
 // Content/viewport changes also rescan, while preserving callers' handlers.
 scrollY=0;list.onContentSizeChange(400,2100);
 await settle(()=>observed().join(',')==='image-0,image-1'&&files.size===2);
});
