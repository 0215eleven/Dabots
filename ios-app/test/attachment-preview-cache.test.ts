import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
function fixture(){let options:any,writes=0,lastSignal:AbortSignal|undefined;
 const file={exists:false,size:0,uri:'file:///synthetic-preview',parentDirectory:{create(){}},writeSync(){writes++;}};
 const mocks:any={react:{useMemo:(fn:any)=>fn(),useState:(value:any)=>[value,()=>{}]},'react-native':{View:'View'},expo:{},'expo-modules-core':{},'expo-image':{Image:'Image'},'expo-sharing':{},'expo-file-system':{Paths:{cache:'file:///cache'},File:class{exists=false;}},
  '@openbot/team-client/remote-peer':{MOBILE_ATTACHMENT_BYTES:10485760},'@tanstack/react-query':{useQuery:(value:any)=>{options=value;return {data:undefined};}},'heroui-native/hooks':{useThemeColor:()=>''},'lucide-react-native/icons/file-text':{},
  '@/features/analytics/failure-reports':{},'@/shared/lib/haptics':{},'@/shared/lib/text':{useText:()=>({t:(x:string)=>x,sourceText:(x:string)=>x}),currentText:(x:string)=>x},
  '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspaceActions:()=>({downloadAttachment:async(_server:string,_id:string,request:any)=>{lastSignal=request?.signal;return{name:'preview.png',mimeType:'image/png',base64:'b2s='};}})},
  '@/features/workspace/model/query-keys':{queryKeys:{chatAttachment:(server:string,id:string)=>['chat-attachment',server,id]}},'./use-media-file':{mediaFile:()=>file},
 };
 const result=buildSync({absWorkingDir:root,entryPoints:['openbot/mobile/src/features/chat/components/attachment-preview.tsx'],bundle:true,write:false,platform:'node',format:'cjs',external:Object.keys(mocks),jsx:'automatic',jsxImportSource:'react',logLevel:'silent'}),module={exports:{} as any};
 new Function('require','module','exports',result.outputFiles[0].text)((name:string)=>Object.hasOwn(mocks,name)?mocks[name]:require(name),module,module.exports);
 return{use:module.exports.useAttachmentFile,get options(){return options},get writes(){return writes},get signal(){return lastSignal}};
}
const attachment={id:'scoped-message-preview',name:'original.png',size:70,kind:'image',mimeType:'image/png',previewKind:'image',previewUrl:null};
test('scoped previews are memory-only, cancel with their query and leave no retained cache entry',async()=>{
 const f=fixture(),controller=new AbortController();f.use('server',{...attachment,downloadMode:'preview'},true);
 assert.equal(f.options.gcTime,0);assert.equal(f.options.staleTime,0);
 const result=await f.options.queryFn({signal:controller.signal});assert.equal(f.signal,controller.signal);assert.equal(f.writes,0);assert.equal(result.fileUri,undefined);
});
test('an unavailable attachment never enables its read query and ordinary upstream images retain their policy',async()=>{
 const f=fixture();f.use('server',{...attachment,downloadMode:'unavailable'},true);assert.equal(f.options.enabled,false);
 const g=fixture();g.use('server',attachment,true);assert.equal(g.options.gcTime,300000);await g.options.queryFn({signal:new AbortController().signal});assert.equal(g.writes,1);
});
