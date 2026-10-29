import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), {transformSync}=require('esbuild');
const noop=()=>{};
const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),createContext:()=>({Provider:'Provider'}),useContext:()=>null,useMemo:(f:any)=>f(),useCallback:(f:any)=>f,useRef:(value:any)=>({current:value}),useState:(value:any)=>[typeof value==='function'?value():value,noop],useEffect:noop,useLayoutEffect:noop,memo:(f:any)=>f};
function load(path:string,mocks:Record<string,any>){const code=transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code;const module={exports:{} as any};new Function('require','module','exports','React',code)((name:string)=>name==='react'?react:mocks[name]??new Proxy({}, {get:()=>noop}),module,module.exports,react);return module.exports;}
function animation(){return {duration(){return this},reduceMotion(value:string){return {...this,motion:value}}};}
const reanimated={__esModule:true,default:{FlatList:'FlatList',View:'AnimatedView'},Easing:{bezier:noop},FadeIn:animation(),LinearTransition:animation(),ReduceMotion:{System:'system',Always:'always'},useSharedValue:(value:any)=>({get:()=>value,set:(next:any)=>{value=next}})};
function screen(hidden:boolean){const agents=[{id:'visible'},{id:'hidden'}];return load('../openbot/mobile/src/features/agents/screens/connected-screen.tsx',{
 'react':{...react,useState:()=>[hidden,noop]},'react-native':{View:'View'},'react-native-reanimated':reanimated,'expo-router':{Stack:{Screen:'Screen'}},
 '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspace:()=>({agents,activeAgents:agents.slice(0,1),activeServer:{id:'h',name:'host'},pinnedAgentIds:['hidden'],pinnedChannelIds:[],hiddenChannelIds:[]})},
 '@/features/channels/components/use-channels':{useChannels:()=>({channels:[]})},'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:0})},
 '@/shared/components/large-title':{useLargeTitleScroll:()=>({})},'@ds/provider':{useDs:()=>({view:{capabilities:{actions:[]}},online:true})},
 '@/features/agents/components/agent-list-reveal':{useAgentListReveal:()=>({})},'@/shared/lib/motion':{useReducedMotion:()=>true},
 }).ConnectedScreen();}
// Render the actual imported screen with deterministic hooks, not a copied selector.
test('quiet canonical motion suppresses retained list transitions',()=>{const tree=screen(false);assert.equal(tree.props.children[1].props.itemLayoutAnimation.motion,'always');});
test('show hidden includes a hidden pinned Bot in the actual pinned section',()=>{const original=react.useState;react.useState=()=>[true,noop];try{const tree=screen(true);const header=tree.props.children[1].props.ListHeaderComponent;assert.deepEqual(header.props.children.at(-1).props.agents.map((a:any)=>a.id),['hidden']);}finally{react.useState=original}});
test('DS provider projects canonical Bot colors into the active avatar graph',()=>{
 const view={serverId:'h',bots:[{id:'b',sourceId:'b',serverId:'h',name:'red',color:'#ff0000'},{id:'c',sourceId:'c',serverId:'h',name:'blue',avatar:{color:'#0000ff'}}],groups:[],conversations:[],capabilities:{actions:[]},work:{}};
 const core={read:()=>view},session={client:{},host:{serverId:'h'},workspace:{getSnapshot:()=>({}),team:{},conversations:[],online:true}};
 const store=class{dispose(){}};
 const tree=load('../src/ds/provider.tsx',{
 '../session/SessionProvider':{useSession:()=>session},'./session-binding':{bindSessionCore:()=>core},'./management':{guardManagement:()=>({core})},'./screen-binding':{createScreenCommands:()=>({})},
 '@/features/workspace/model/conversation-store':{MobileConversationStore:store},'@/features/workspace/model/live-workspace-store':{LiveWorkspaceStore:store},'@/features/channels/model/channel-store':{MobileChannelStore:store},
 '../theme':{useTheme:()=>({}),useColorMode:()=>('light')},'../i18n':{useI18n:()=>({locale:'en'})},
 './presentation':load('../src/ds/presentation.ts',{'../components/characterData.json':require('../src/components/characterData.json')}),
 }).DsProvider({children:null});
 const [red,blue]=tree.props.value.agents;assert.equal(red.avatarHue,0);assert.equal(blue.avatarHue,245);assert.equal(red.avatarColor,'#ff0000');assert.equal(blue.avatarColor,'#0000ff');
});
test('DS color precedence preserves storage while selecting nearest supported hue',()=>{
 const {botAvatarHue}=load('../src/ds/presentation.ts',{'../components/characterData.json':require('../src/components/characterData.json')});const bot={color:'#00ff00',avatar:{color:'#0000ff'}};
 assert.equal(botAvatarHue(bot),245);assert.equal(botAvatarHue({color:'#ff0000'}),0);assert.equal(botAvatarHue({color:'invalid'}),null);assert.equal(botAvatarHue({color:'#ffffff'}),null);assert.deepEqual(bot,{color:'#00ff00',avatar:{color:'#0000ff'}});
});
test('quiet pin still commits without measuring or scheduling avatar travel',async()=>{
 let commits=0,measurements=0;const old=(globalThis as any).requestAnimationFrame;(globalThis as any).requestAnimationFrame=(f:any)=>f();
 try{
 const workspace={agents:[{id:'b',avatarHue:0,avatarSeed:'b'}],pinnedAgentIds:[],pinnedChannelIds:[],toggleAgentPin:async()=>{commits++;return 'pinned'}};
 const provider=load('../openbot/mobile/src/features/agents/components/agent-pin-transition.tsx',{
 'react-native':{View:'View'},'react-native-reanimated':reanimated,'@/shared/lib/motion':{useReducedMotion:()=>true},
 '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspaceReader:()=>()=>workspace},'@/features/workspace/model/agent-pins':{canToggleAgentPin:()=>true},'@/shared/lib/haptics':{haptics:{selection:noop}},
 }).AgentPinTransitionProvider({children:null});
 const measured={measureInWindow:(f:any)=>{measurements++;f(0,0,40,40)}};provider.props.children[0].props.ref.current=measured;
 const controls=provider.props.value;controls.registerAvatar('b','row',measured);measurements=0;controls.toggleAgentPinAnimated('b');await Promise.resolve();
 assert.equal(commits,1);assert.equal(measurements,0);
 }finally{(globalThis as any).requestAnimationFrame=old}
});

test('active avatar preview consumes the exact canonical color, including grayscale',()=>{
 const workspace={agents:[{id:'b',avatarColor:'#777777'}]};
 const {BloubAvatarPreview}=load('../openbot/mobile/src/features/agents/components/bloub-avatar.tsx',{
 'react-native-reanimated':{...reanimated,default:{createAnimatedComponent:(c:any)=>c}},
 '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspaceSelector:(f:any)=>f(workspace)},
 './agent-photo':{AgentPhoto:'Photo'},
 });
 const tree=BloubAvatarPreview({agentId:'b',seed:'b',hue:0});assert.equal(tree.props.children[0].props.color,'#777777');
 const edited=BloubAvatarPreview({agentId:'b',seed:'b',hue:0,color:'#123456'});assert.equal(edited.props.children[0].props.color,'#123456');
});
test('DS named avatar palette remains canonical in light and dark appearance',()=>{
 const {botAvatarColor}=load('../src/ds/presentation.ts',{'../components/characterData.json':require('../src/components/characterData.json')});const {inks}=require('../src/components/characterData.json');
 for(const [name,colors] of Object.entries(inks) as Array<[string,string[]]>){assert.equal(botAvatarColor({color:name}),colors[0]);assert.equal(botAvatarColor({color:name},true),colors[1]);}
});
