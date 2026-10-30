import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url), {transformSync}=require('esbuild');
const element=(type:any,props:any,...children:any[])=>({type,props:{...props,...(children.length?{children:children.length===1?children[0]:children}:{})}});
function load(path:string,mocks:Record<string,any>,react:any){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  const code=path.endsWith('.tsx')?transformSync(source,{loader:'tsx',format:'cjs',jsx:'transform'}).code:source;
  const module={exports:{} as any};
  new Function('require','module','exports','React','process',code)((name:string)=>{
    if(!(name in mocks))throw Error('Unexpected dependency: '+name);
    return mocks[name];
  },module,module.exports,react,{env:{EXPO_OS:'ios'}});
  return module.exports;
}
function fixture(ios=true){
  let cursor=0,dimensions={width:390,height:844,fontScale:1,scale:3};const state:any[]=[];
  const react={createElement:element,use:()=>({isVisible:true,href:'/chat/b'}),useState(initial:any){const n=cursor++;if(!(n in state))state[n]=initial;return [state[n],(next:any)=>{state[n]=typeof next==='function'?next(state[n]):next}];}};
  // Exercise the installed Expo58 preference/actual-content boundary, not a copy
  // of Link.Preview. UIKit and native text/layout still require device testing.
  const sdk=load('../node_modules/expo-router/build/link/elements.js',{
    react,'react/jsx-runtime':{jsx:element,jsxs:element},'../primitives':{},'../ui/Slot':{},'../utils/children':{},
    './InternalLinkPreviewContext':{InternalLinkPreviewContext:{}},'./NativeMenuContext':{},'./preview/HrefPreview':{},
    './preview/PreviewRouteContext':{useIsPreview:()=>false},'./preview/native':{NativeLinkPreviewContent:'NativePreview'},'./zoom/link-apple-zoom':{},
  },react);
  const source=load('../openbot/mobile/src/features/agents/components/agent-chat-preview.tsx',{
    react,'react-native':{View:'View',useWindowDimensions:()=>dimensions},'expo-router':{Link:{Preview:sdk.LinkPreview}},
    'heroui-native':{Typography:{Paragraph:'Paragraph'}},'heroui-native/hooks':{useThemeColor:()=> '#fff'},
    '@/features/agents/components/bloub-avatar':{BloubAvatar:'Avatar'},'@/features/chat/components/chat-markdown':{ChatMarkdown:'Markdown'},
    '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspaceSelector:(read:any)=>read({agents:[]})},'@/shared/lib/platform':{isIOS:ios},
  },react);
  const agent={id:'b',serverId:'h',name:'Isolated Bot',title:'',preview:'one',avatarHue:0,avatarSeed:'b',avatarUrl:null};
  const render=()=>{cursor=0;return source.useAgentChatPreview(agent)};
  return {agent,render,resize:(next:Partial<typeof dimensions>)=>{dimensions={...dimensions,...next}},native:(preview:any)=>sdk.LinkPreview(preview.props)};
}
const children=(node:any):any[]=>Array.isArray(node?.props?.children)?node.props.children:[node?.props?.children];

test('iOS preview has its own content size when Expo removes width and height from host styles',()=>{
  const f=fixture(),result=f.render(),native=f.native(result.preview);
  assert.deepEqual(native.props.preferredContentSize,{width:358,height:140});
  assert.equal(native.props.style.width,undefined,'SDK forwards dimensions as preferences, not host layout');
  assert.equal(native.props.children.props.style?.width,358,'actual preview content must not inherit a pinned tile width');
  assert.equal(native.props.children.props.style?.height,140);
});
test('visible and premeasured bubbles have the same independent width',()=>{
  const f=fixture();f.render().onPressIn();const result=f.render();
  const content=children(result.preview)[0],body=children(content).at(-1),bubble=children(body)[0];
  const measured=children(result.measurer)[0];
  assert.equal(bubble.type(bubble.props).props.style.width,326);
  assert.equal(measured.type(measured.props).props.style.width,326);
});
test('message and viewport changes cannot reuse a measurement from different content',()=>{
  const f=fixture();f.render().onPressIn();let result=f.render();
  children(result.measurer)[0].props.onHeight(240);
  assert.equal(f.render().preview.props.style.height,329);
  f.agent.preview='two';assert.equal(f.render().preview.props.style.height,140);
  f.agent.preview='one';f.resize({width:844,height:390});assert.equal(f.render().preview.props.style.height,140);
  f.resize({width:390,height:844,fontScale:2});assert.equal(f.render().preview.props.style.height,167);
});
test('a tall or invalid measurement cannot make the preview exceed the window',()=>{
  const f=fixture();f.render().onPressIn();let result=f.render();
  children(result.measurer)[0].props.onHeight(3000);
  assert.ok(f.render().preview.props.style.height<=812);
  for(const height of [0,-1,NaN,Infinity]){
    result=f.render();children(result.measurer)[0].props.onHeight(height);
    assert.ok(Number.isFinite(f.render().preview.props.style.height));
    assert.equal(f.render().preview.props.style.height,812,'invalid events must not replace the last valid measurement');
  }
});
test('empty previews retain the header and other platforms do not mount native preview content',()=>{
  const f=fixture();f.agent.preview='';assert.equal(f.render().preview.props.style.height,65);
  const other=fixture(false);const result=other.render();assert.equal(result.preview,null);assert.equal(result.measurer,null);assert.equal(result.onPressIn,undefined);
});
