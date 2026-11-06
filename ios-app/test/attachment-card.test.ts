import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {attachmentFrame} from '../openbot/mobile/src/features/chat/model/attachment-frame.ts';

const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
function fixture(width=390){
 const opened:any[]=[];
 const element=(type:any,props:any,...children:any[])=>({type,props:{...props,...(children.length?{children:children.length===1?children[0]:children}:{})}});
 const react={createElement:element,useState:(initial:any)=>[initial,()=>{}],useEffect:()=>{}};
 const mocks:any={react,'react-native':{View:'View',Pressable:'Pressable',useWindowDimensions:()=>({width})},'react-native-reanimated':{default:{View:'AnimatedView'}},
  '@openbot/contracts/attachment-files':{playableMediaKind:()=>null},'@openbot/contracts/chat-visual':{},'@openbot/team-client/remote-peer':{MOBILE_ATTACHMENT_BYTES:10485760},expo:{requireOptionalNativeModule:()=>null},'expo-file-system':{},'expo-image':{Image:'Image'},'expo-router':{},
  'heroui-native':{Button:Object.assign('Button',{Label:'Label'}),Skeleton:'Skeleton',Typography:{Paragraph:'Paragraph'}},'heroui-native/hooks':{useThemeColor:()=>['green','gray']},
  '@/shared/lib/haptics':{},'@/shared/lib/text':{useText:()=>({t:(key:string,args:any)=>key+JSON.stringify(args??{}),sourceText:(value:string)=>value,format:{fileSize:(size:number)=>String(size)}})},
  '../model/attachment-frame':{attachmentFrame,FRAME_RADIUS:18,MAX_FRAME_WIDTH:280,FILL:{position:'absolute',top:0,right:0,bottom:0,left:0}},'../model/code-preview-store':{},'../model/image-dimensions':{},
  './attachment-preview':{useAttachmentFile:()=>({pending:false,localUri:null,uri:'data:image/png;base64,synthetic',dimensions:{width:640,height:480},query:{},sharing:false}),attachmentTypeLabel:()=> 'FILE'},
  './chat-image-viewer':{isViewableImage:()=>true,useChatImageSource:()=>({origin:{},hiddenStyle:{},open:(attachment:any)=>opened.push(attachment)})},
  '@ds/preview-range':{usePreviewRange:()=>({visible:true,onLayout(){}})},
  './upload-progress':{useUploadRevealStyle:()=>({})},'./use-attachment-preview':{useAttachmentPreview:()=>({kind:null,opening:false})},'./use-history-shown':{},'./use-list-settled':{},'./use-media-file':{},'./chat-code-preview':{},'./html-page':{},
 };
 const code=transformSync(readFileSync(new URL('../openbot/mobile/src/features/chat/components/chat-attachment.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code,module={exports:{} as any};
 new Function('require','module','exports','React',code)((name:string)=>name.startsWith('lucide-react-native/')?{default:'Icon'}:name in mocks?mocks[name]:(()=>{throw Error('Unexpected dependency '+name)})(),module,module.exports,react);
 const render=(attachment:any)=>{const node=module.exports.ChatAttachmentView({serverId:'synthetic',attachment});return node.type(node.props)};
 return{render,opened};
}
function nodes(node:any):any[]{return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(2).flatMap(nodes)]}
const photo={id:'scoped-preview',name:'photo.heic',size:70000,kind:'image',mimeType:'image/png',previewKind:'image',previewUrl:null,downloadMode:'preview',originalFile:{name:'photo.heic',size:100000000}};
test('actual photo card uses a bounded whole-image frame and opens its structured attachment',()=>{
 for(const width of [320,390,844]){
  const f=fixture(width),tree=f.render(photo),all=nodes(tree),images=all.filter(node=>node.type==='Image');
  assert.equal(images.length,1);assert.equal(images[0].props.cachePolicy,'none');assert.equal(images[0].props.contentFit,'contain');
  const frame=all.find(node=>node.props?.style?.height&&node.props?.style?.width);assert.ok(frame.props.style.width<=Math.min(280,width-80));assert.ok(frame.props.style.height<=240);
  const press=all.find(node=>node.type==='Pressable');assert.equal(press.props.disabled,false);press.props.onPress();assert.deepEqual(f.opened,[photo]);
  const captions=all.filter(node=>node.type==='Paragraph').map(node=>node.props.children).join(' ');assert.ok(captions.includes('photo.heic'));assert.ok(captions.includes('100000000'));assert.ok(!captions.includes('sha256'));
 }
});
test('ordinary files and photos without a safe preview remain compact, disabled file cards',()=>{
 const f=fixture(),tree=f.render({...photo,kind:'file',downloadMode:'unavailable',originalFile:undefined,size:100000000}),all=nodes(tree);
 assert.equal(all.filter(node=>node.type==='Image').length,0);const button=all.find(node=>node.props?.isDisabled!==undefined);assert.equal(button.props.isDisabled,true);assert.ok(button.props.accessibilityHint.includes('desktopFileHint'));
});
