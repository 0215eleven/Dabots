import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), {transformSync}=require('esbuild');
const noop=()=>{};
const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),createContext:()=>({Provider:'Provider'}),useContext:()=>null,useMemo:(f:any)=>f(),useCallback:(f:any)=>f,useRef:(value:any)=>({current:value}),useState:(value:any)=>[typeof value==='function'?value():value,noop],useEffect:noop,useLayoutEffect:noop,memo:(f:any)=>f};
function load(path:string,mocks:Record<string,any>){const code=transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code;const module={exports:{} as any};new Function('require','module','exports','React',code)((name:string)=>name==='react'?react:mocks[name]??(name==='../names/ComputerNamesProvider'?{useComputerNames:()=>({name:(host:any)=>host?.name??'DeepSeek Bot Pro',load:async()=>{},rename:async()=>{},error:''})}:new Proxy({}, {get:()=>noop})),module,module.exports,react);return module.exports;}
function animation(){return {duration(){return this},reduceMotion(value:string){return {...this,motion:value}}};}
const reanimated={__esModule:true,default:{FlatList:'FlatList',View:'AnimatedView'},Easing:{bezier:noop},FadeIn:animation(),LinearTransition:animation(),ReduceMotion:{System:'system',Always:'always'},useSharedValue:(value:any)=>({get:()=>value,set:(next:any)=>{value=next}})};
function screen(hidden:boolean,insets:{top:number;bottom:number;left?:number;right?:number}={top:0,bottom:0},online=true,hosts=[{serverId:'h',name:'host',slot:'a'}],peers:Record<string,any>={},times:Record<string,number>={}){const agents=[{id:'visible'},{id:'hidden'}];return load('../openbot/mobile/src/features/agents/screens/connected-screen.tsx',{
 '@ds/text':{useDsText:()=>({tr:(text:string)=>text,locale:'en'})},'heroui-native/hooks':{useThemeColor:(names:any)=>Array.isArray(names)?names.map(()=>'#141414'):'#141414'},'react':{...react,useState:()=>[hidden,noop]},'react-native':{View:'View',Pressable:'Pressable',StyleSheet:{hairlineWidth:0.5}},'react-native-reanimated':reanimated,'expo-router':{Stack:{Screen:'Screen'}},
 '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspace:()=>({agents,activeAgents:agents.slice(0,1),activeServer:{id:'h',name:'host'},pinnedAgentIds:['hidden'],pinnedChannelIds:[],hiddenChannelIds:[]})},
 '@/features/channels/components/use-channels':{useChannels:()=>({channels:[]})},'react-native-safe-area-context':{useSafeAreaInsets:()=>({left:0,right:0,...insets})},
 '@/shared/components/large-title':{useLargeTitleScroll:()=>({})},'@ds/provider':{useDs:()=>({view:{capabilities:{actions:[]}},online,times})},
 '@/features/agents/components/agent-list-reveal':{useAgentListReveal:()=>({})},'@/shared/lib/motion':{useReducedMotion:()=>true},
 '@ds/computers':{useComputers:()=>({hosts,host:hosts[0],switchHost:async()=>true}),useComputerNames:()=>({name:(host:any)=>host.name}),usePeerHosts:()=>({peers}),peerBotColor:()=>()=>null,peerRows:(peer:any)=>peer.rows},'uniwind':{useUniwind:()=>({theme:'light'})},'@/features/agents/components/peer-chat-row':{PeerChatRow:'PeerChatRow'},'@/features/workspace/components/computer-tag':{ComputerTagContext:{Provider:'TagProvider'}},
 }).ConnectedScreen();}
// Render the actual imported screen with deterministic hooks, not a copied selector.
// Find rendered elements by type, so the checks follow the screen's behavior rather than its nesting.
function find(node:any,match:(node:any)=>boolean):any{if(!node||typeof node!=='object')return undefined;if(Array.isArray(node)){for(const child of node){const hit=find(child,match);if(hit)return hit;}return undefined;}if(match(node))return node;const props=node.props??{};for(const key of Object.keys(props)){const hit=find(props[key],match);if(hit)return hit;}return undefined;}
test('quiet canonical motion suppresses retained list transitions',()=>{const tree=screen(false);assert.equal(find(tree,n=>n.type==='FlatList').props.itemLayoutAnimation.motion,'always');});
test('home keeps its top empty and floats the menu, with its connection indicator, at the bottom',()=>{
 for(const online of [true,false]){
  const tree=screen(false,{top:0,bottom:34},online),header=find(tree,n=>n.type==='FlatList').props.ListHeaderComponent;
  assert.equal(find(header,n=>n.props?.accessibilityRole==='header'),undefined);
  assert.equal(find(header,n=>n.props?.label==='Settings'),undefined);
  const bar=find(tree,n=>n.props?.pointerEvents==='box-none'&&n.props.style?.bottom!==undefined);
  assert.equal(bar.props.style.bottom,38,'bottom actions sit just above the home indicator');
  const menu=find(bar,n=>n.props?.label==='Settings');
  assert.equal(menu.type(menu.props).props.accessibilityValue.text,online?'Connected':'Disconnected');
  assert.ok(find(menu,n=>n.props?.pointerEvents==='none'&&n.props.style.width===7));
 }
});
test('home shows computer chips only with several computers, and tags rows in All',()=>{
 const single=screen(false);
 assert.equal(find(single,n=>n.props?.accessibilityRole==='tab'),undefined);
 assert.equal(find(single,n=>n.type==='TagProvider').props.value,null);
 const tree=screen(false,{top:0,bottom:0},true,[{serverId:'h',name:'Office',slot:'a'},{serverId:'s',name:'Home',slot:'b'}]);
 const header=find(tree,n=>n.type==='FlatList').props.ListHeaderComponent;
 const chips:any[]=[];find(header,n=>{if(n.props?.label!==undefined&&typeof n.type==='function'&&n.type.name==='ComputerChip')chips.push(n.props);return false;});
 assert.deepEqual(chips.map(c=>[c.label,c.selected,c.status]),[['All',true,undefined],['Office',false,'online'],['Home',false,'offline']]);
 assert.deepEqual([...find(tree,n=>n.type==='TagProvider').props.value],[['h','Office'],['s','Home']]);
});
test('All merges the other computers\' chats with the active ones, newest first',()=>{
 const hosts=[{serverId:'h',name:'Office',slot:'a'},{serverId:'s',name:'Home',slot:'b'}];
 const peer={online:true,rows:[{id:'ds:s:bot:p',serverId:'s',kind:'bot',name:'Ops',at:200}]};
 const tree=screen(false,{top:0,bottom:0},true,hosts,{s:peer},{visible:100});
 const list=find(tree,n=>n.type==='FlatList');
 assert.deepEqual(list.props.data.map((item:any)=>item.id),['ds:s:bot:p','visible']);
 const row=list.props.renderItem({item:list.props.data[0],index:0});
 assert.equal(row.type,'PeerChatRow');assert.equal(row.props.online,true);
 const chips:any[]=[];find(list.props.ListHeaderComponent,n=>{if(typeof n.type==='function'&&n.type.name==='ComputerChip')chips.push(n.props);return false;});
 assert.equal(chips.find(c=>c.label==='Home').status,'online','a watched computer shows its own status');
});
test('show hidden includes a hidden pinned Bot in the actual pinned section',()=>{const original=react.useState;react.useState=()=>[true,noop];try{const tree=screen(true);const header=find(tree,n=>n.type==='FlatList').props.ListHeaderComponent;assert.deepEqual(find(header,n=>Array.isArray(n.props?.agents)).props.agents.map((a:any)=>a.id),['hidden']);}finally{react.useState=original}});
test('home consumes each native safe-area inset once, including notches and landscape',()=>{
 // UIKit adds its safe-area inset when automatic adjustment is enabled. The home
 // has its own padding because its native Stack header is hidden; count both
 // boundary contributions, rather than checking a source string or CSS class.
 for (const fixture of [
  // The bottom padding also leaves 60 points for the floating Settings and New actions.
  {top:59,bottom:34,wantTop:65,wantBottom:118},
  {top:20,bottom:0,wantTop:26,wantBottom:84},
  {top:0,bottom:21,wantTop:6,wantBottom:105},
  {top:0,bottom:21,left:59,right:59,wantTop:6,wantBottom:105},
 ]) {
  const {props}=find(screen(false,fixture),n=>n.type==='FlatList');
  const automatic=(props.contentInsetAdjustmentBehavior??'never')!=='never';
  const actualTop=props.contentContainerStyle.paddingTop+(automatic?fixture.top:0);
  const actualBottom=props.contentContainerStyle.paddingBottom+(automatic?fixture.bottom:0);
  assert.equal(actualTop,fixture.wantTop,'content must clear the status bar exactly once');
  assert.equal(actualBottom,fixture.wantBottom,'keep bottom safe-area clearance without doubling it');
  assert.equal((props.contentContainerStyle.paddingLeft??0)+(automatic?(fixture.left??0):0),fixture.left??0,'left avatar and rows must clear a landscape notch once');
  assert.equal((props.contentContainerStyle.paddingRight??0)+(automatic?(fixture.right??0):0),fixture.right??0,'creation action must clear the opposite safe-area edge once');
 }
});
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
test('actual DS provider follows resolved System appearance and invalidates its memo on appearance changes',()=>{
 const view={serverId:'h',bots:[{id:'b',sourceId:'b',serverId:'h',name:'named',color:'deepseek'}],groups:[],conversations:[],capabilities:{actions:[]},work:{}};
 const core={read:()=>view},session={client:{},host:{serverId:'h'},workspace:{getSnapshot:()=>({}),team:{},conversations:[],online:true}};
 const store=class{dispose(){}};let dark=true,cursor=0;const memo:Array<{deps:any[];value:any}>=[];const original=react.useMemo;
 // Preserve React's dependency behavior across provider renders; all host objects and
 // the preference 'system' stay identical while resolved OS appearance changes.
 react.useMemo=(factory:any,deps:any[]=[])=>{const index=cursor++,previous=memo[index];if(previous&&deps.every((value,i)=>Object.is(value,previous.deps[i])))return previous.value;const value=factory();memo[index]={deps:[...deps],value};return value;};
 try {
  const {DsProvider}=load('../src/ds/provider.tsx',{
   '../session/SessionProvider':{useSession:()=>session},'./session-binding':{bindSessionCore:()=>core},'./management':{guardManagement:()=>({core})},'./screen-binding':{createScreenCommands:()=>({})},
   '@/features/workspace/model/conversation-store':{MobileConversationStore:store},'@/features/workspace/model/live-workspace-store':{LiveWorkspaceStore:store},'@/features/channels/model/channel-store':{MobileChannelStore:store},
   '../theme':{useTheme:()=>({dark}),useColorMode:()=>('system')},'../i18n':{useI18n:()=>({locale:'en'})},
   './presentation':load('../src/ds/presentation.ts',{'../components/characterData.json':require('../src/components/characterData.json')}),
  });
  const render=()=>{cursor=0;return DsProvider({children:null}).props.value.agents;};const colors=require('../src/components/characterData.json').inks.deepseek;
  const initial=render();assert.equal(initial[0].avatarColor,colors[1]);assert.equal(render(),initial);
  dark=false;const changed=render();assert.equal(changed[0].avatarColor,colors[0]);assert.notEqual(changed,initial);
  dark=true;assert.equal(render()[0].avatarColor,colors[1]);
 }finally{react.useMemo=original;}
});

test('hidden Bot native menu branches react to the locale using the existing Show catalog',()=>{
 let locale='zh';const agent={id:'b',serverId:'h',name:'User supplied name'};
 const {transformSync}=require('esbuild');
 const en=load('../openbot/packages/i18n/src/messages/en/mobile/agent.ts',{'../../../message':{defineMessages:(_:string,m:any)=>m}}),zh=load('../openbot/packages/i18n/src/messages/zh/mobile/agent.ts',{'../../../message':{defineMessages:(_:string,m:any)=>m}});
 const dictionary=(value:any):any=>Object.values(value).find((v:any)=>v&&typeof v==='object'&&'mobile.agent.hidden.show'in v);
 const mocks:any={
  '@ds/provider':{useDs:()=>({view:{bots:[{id:'b',hidden:true}],capabilities:{actions:['set-flags']}}})},
  'expo-router':{Link:Object.assign('Link',{Menu:'Menu',MenuAction:'MenuAction',Trigger:'Trigger'})},
  'react-native':{StyleSheet:{create:(v:any)=>v},View:'View'},uniwind:{useUniwind:()=>({theme:'light'})},
  '@/features/workspace/context/mobile-workspace-context':{useMobileWorkspaceReader:()=>()=>({}),useMobileWorkspaceSelector:(fn:any)=>fn({pinnedAgentIds:[],pinnedChannelIds:[]})},
  '@/features/agents/components/agent-pin-transition':{useAgentPinTransition:()=>({})},
  '@/features/agents/components/use-chat-section-menu':{useChatSectionMenu:()=>({menu:null,androidActions:[]})},
  '@/features/workspace/model/agent-pins':{canToggleAgentPin:()=>true},
  '@/shared/lib/text':{useText:()=>({t:(key:string)=>(locale==='zh'?dictionary(zh):dictionary(en))[key]??key})},
  '@/shared/components/menu-view':{MenuView:'MenuView'},
 };
 const path='../openbot/mobile/src/features/agents/components/agent-context-menu.tsx';
 // Export the private Android leaf for this actual-source render only.
 const code=transformSync(readFileSync(new URL(path,import.meta.url),'utf8')+'\nexport {OpenAgentMenu};',{loader:'tsx',format:'cjs',jsx:'transform'}).code;
 const module={exports:{} as any};new Function('require','module','exports','React',code)((name:string)=>name==='react'?react:mocks[name]??new Proxy({}, {get:()=>noop}),module,module.exports,react);
 const walk=(node:any):any[]=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];
 for(const selected of ['zh','en','zh']){locale=selected;const expected=selected==='zh'?'显示':'Show';const ios=module.exports.AgentContextMenuLink({agent,preview:null,children:null});assert.ok(walk(ios).some(node=>node.type==='MenuAction'&&node.props.children.includes(expected)));const android=module.exports.OpenAgentMenu({agent,size:{width:30,height:30},onClose:noop});assert.equal(android.props.actions.find((a:any)=>a.id==='hide').title,expected);assert.equal(agent.name,'User supplied name');}
});

test('resolved group transcript previews publish into the actual channel store without unrelated workspace changes',()=>{
 const view:any={serverId:'h',bots:[{id:'b',sourceId:'b',serverId:'h',name:'Bot',conversationId:'cg'}],groups:[{id:'g',name:'Group',members:[],conversationId:'cg'}],conversations:[{id:'cg',source:{id:'raw',updatedAt:1000,preview:'old host summary'}}],capabilities:{actions:[],history:true},work:{}};
 const core={read:()=>view},session={client:{},host:{serverId:'h'},workspace:{getSnapshot:()=>({}),team:{},conversations:[],online:true}};
 const store=class{dispose(){} update(){}};let previews:any={},cursor=0;const slots:any[]=[];
 const originalMemo=react.useMemo,originalLayout=react.useLayoutEffect;
 const same=(a:any[],b:any[])=>!!a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 react.useMemo=(factory:any,deps:any[]=[])=>{const n=cursor++;if(!same(slots[n]?.deps,deps))slots[n]={deps,value:factory()};return slots[n].value;};
 react.useLayoutEffect=((effect:any,deps:any[])=>{const n=cursor++;if(!same(slots[n]?.deps,deps)){slots[n]={deps};effect()}}) as any;
 try{
  const {MobileChannelStore}=load('../openbot/mobile/src/features/channels/model/channel-store.ts',{'@tanstack/react-query':require('@tanstack/react-query')});
  const {DsProvider}=load('../src/ds/provider.tsx',{
   '../session/SessionProvider':{useSession:()=>session},'./session-binding':{bindSessionCore:()=>core},'./management':{guardManagement:()=>({core})},'./screen-binding':{createScreenCommands:()=>({})},
   '@/features/workspace/model/conversation-store':{MobileConversationStore:store},'@/features/workspace/model/live-workspace-store':{LiveWorkspaceStore:store},'@/features/channels/model/channel-store':{MobileChannelStore},
   '../theme':{useTheme:()=>({}),useColorMode:()=>('light')},'../i18n':{useI18n:()=>({locale:'en'})},'../home/usePreviews':{usePreviews:()=>previews},'../logic/conversation-order':load('../src/logic/conversation-order.ts',{}),'./presentation':load('../src/ds/presentation.ts',{'../components/characterData.json':require('../src/components/characterData.json')}),
  });
  const render=()=>{cursor=0;return DsProvider({children:null}).props.children[0].props.value};
  const channels=render().channelStore;assert.equal(channels.get('h').channels[0].lastMessage,null);
  previews={raw:{text:'New group transcript',createdAt:2000}};render();
  assert.equal(channels.get('h').channels[0].lastMessage?.text,'New group transcript');
  view.capabilities.history=false;assert.equal(render().agents[0].preview,'');assert.equal(channels.get('h').channels[0].lastMessage,null);
  previews={};render();assert.equal(channels.get('h').channels[0].lastMessage,null);
 }finally{react.useMemo=originalMemo;react.useLayoutEffect=originalLayout}
});
