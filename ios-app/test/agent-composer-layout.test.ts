import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {transformSync}=createRequire(import.meta.url)('esbuild');

test('classic Agent composer uses the same measured keyboard dock and preserves multiline sending',()=>{
 const drafts:string[]=[],sizes:number[]=[],motion={keyboardProgress:{},composerStyle:{translateY:-350},onComposerLayout:(event:any)=>sizes.push(event.nativeEvent.layout.height)};
 let sent=0;
 const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),useMemo:(fn:any)=>fn(),useCallback:(fn:any)=>fn,useRef:(value:any)=>({current:value}),useState:(value:any)=>[value,()=>{}]};
 const chat={messages:[],outgoing:[],draft:'Line one\nLine two',status:'connected',setDraft:(value:string)=>drafts.push(value),send:()=>{sent++}};
 const mocks:any={react,'react-native':{View:'View'},'react-native-reanimated':{default:{View:'AnimatedView'}},'expo-glass-effect':{isLiquidGlassAvailable:()=>false},'heroui-native/hooks':{useThemeColor:()=>[]},'react-native-keyboard-controller':{KeyboardGestureArea:'KeyboardArea'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:59,bottom:34})},'../chat/useChat':{useChat:()=>chat},'../session/SessionProvider':{useSession:()=>({host:{serverId:'test'},workspace:{team:{bots:[],rooms:[]},online:true}})},'./adapters/chat-model':{chatTarget:()=>({}),pendingChatMessages:()=>({messages:[],waiting:[]}),toChatMessages:()=>[],outboxStatuses:()=>[]},'@legacy/features/chat/components/chat-composer':{ChatComposer:'Composer'},'@legacy/features/chat/components/chat-message-list':{ChatMessageList:'List'},'@legacy/features/chat/components/use-chat-motion':{useChatMotion:()=>motion},'@legacy/shared/lib/use-reduced-transparency':{useReducedTransparency:()=>false}};
 const code=transformSync(readFileSync(new URL('../src/openbot/chat-screen.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code,module={exports:{} as any};
 // esbuild's default export interop expects an ES-module marker for this mock.
 mocks['react-native-reanimated'].__esModule=true;
 new Function('require','module','exports',code)((name:string)=>{if(!(name in mocks))throw Error(name);return mocks[name]},module,module.exports);
 const tree=module.exports.OpenBotChat({conversation:{id:'agent:a:s',kind:'agent',name:'My Agent'}});
 const nodes=(n:any):any[]=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
 const dock=nodes(tree).find(n=>n.type==='AnimatedView'&&n.props.style?.includes(motion.composerStyle));
 assert.ok(dock,'composer must consume its actual motion style');
 dock.props.onLayout({nativeEvent:{layout:{height:132}}});assert.deepEqual(sizes,[132]);
 const composer=nodes(dock).find(n=>n.type==='Composer');assert.equal(composer.props.bottomInset,34);assert.equal(composer.props.draft,'Line one\nLine two');composer.props.onSend('Changed\ntext');assert.deepEqual(drafts,['Changed\ntext']);assert.equal(sent,1);
});
