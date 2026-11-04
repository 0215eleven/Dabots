import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const {transformSync}=createRequire(import.meta.url)('esbuild');
function list(rename=true){
 const opened:string[]=[],renamed:string[]=[],react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}})};
 const mocks:any={'heroui-native':{Typography:{Heading:'Heading',Paragraph:'Text'}},'heroui-native/hooks':{useThemeColor:()=>['blue','gray','gray']},'lucide-react-native/icons/square-terminal':()=>null,'lucide-react-native/icons/pencil':()=>null,'react-native':{Pressable:'Pressable',ScrollView:'Scroll',View:'View',StyleSheet:{hairlineWidth:1}},'@/shared/lib/format-updated-at':{formatUpdatedAt:()=>''},'@/shared/lib/haptics':{haptics:{impact:async()=>{}}},'@ds/text':{useDsText:()=>({tr:(text:string,args:any)=>args?text.replace('{name}',args.name):text})}};
 const code=transformSync(readFileSync(new URL('../openbot/mobile/src/features/agents/components/agent-list-view.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code,module={exports:{} as any};new Function('require','module','exports','React',code)((name:string)=>{if(!(name in mocks))throw Error(name);return mocks[name]},module,module.exports,react);
 const tree=module.exports.AgentListView({agents:[{id:'a',name:'Saved title',source:{updatedAt:2}}],canCreate:true,error:'',topInset:59,bottomInset:118,sideInsets:{left:0,right:0},onOpen:(a:any)=>opened.push(a.id),...(rename?{onRename:(a:any)=>renamed.push(a.id)}:{})});
 const nodes=(x:any):any[]=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 return{nodes:nodes(tree),opened,renamed};
}
test('Agent list keeps creation out of its header and separates rename from opening a chat',()=>{
 const f=list();assert.equal(f.nodes.some(n=>n.props?.size==='lg'),false);
 f.nodes.find(n=>n.props.accessibilityLabel==='Rename Saved title').props.onPress();assert.deepEqual(f.renamed,['a']);assert.deepEqual(f.opened,[]);
 f.nodes.find(n=>n.props.accessibilityLabel==='Saved title').props.onPress();assert.deepEqual(f.opened,['a']);
 assert.equal(list(false).nodes.some(n=>n.props.accessibilityLabel?.startsWith('Rename ')),false);
});
