import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const {transformSync}=createRequire(import.meta.url)('esbuild');
function form(){
 let cursor=0,back=0,calls=0,guard=false,refreshes=0,resolve!:()=>void,reject!:(error:Error)=>void;
 const slots:any[]=[],effects:Array<()=>void>=[],conversation:any={id:'agent:a:s',kind:'agent',agentId:'a',sessionId:'s',name:'Existing title'};
 const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),useRef(initial:any){const n=cursor++;return slots[n]??= {current:initial}},useState(initial:any){const n=cursor++;if(!(n in slots))slots[n]=initial;return[slots[n],(value:any)=>{slots[n]=value}]},useEffect(effect:any,deps:any[]){const n=cursor++,old=slots[n];if(old&&deps.every((v,i)=>v===old[i]))return;slots[n]=deps;effects.push(effect)}};
 const router={back:()=>{assert.equal(guard,false);back++}},Button=Object.assign('Button',{Label:'Label'}),workspace={online:true,team:{readOnly:null},refresh:async()=>{refreshes++}};
 const mocks:any={react,'expo-router':{useRouter:()=>router,Stack:{Toolbar:Object.assign('Toolbar',{Button:'ToolbarButton'})}},'expo-router/react-navigation':{usePreventRemove:(value:boolean)=>{guard=value}},'react-native':{Platform:{OS:'web'},View:'View'},'heroui-native':{Button,Typography:{Paragraph:'Paragraph'}},'@/shared/components/sheet-scroll-view':{SheetScrollView:'Scroll'},'@/shared/components/sheet-form-field':{SheetFormField:'Field'},'@/shared/components/sheet-save-action':{SheetSaveAction:'Save'},'../src/session/SessionProvider':{useSession:()=>({client:{},workspace})},'../src/ds/provider':{},'../src/ds/agent-route':{},'../src/i18n':{useI18n:()=>({tr:(v:string)=>v})},'../src/logic/agent-title':{normalizeAgentTitle:(value:string)=>{if(!value.trim())throw Error();return value.trim()},renameAgentTitle:async()=>{calls++;await new Promise<void>((yes,no)=>{resolve=yes;reject=no})}}};
 const source=readFileSync(new URL('../app/agent-name.tsx',import.meta.url),'utf8'),code=transformSync(source,{loader:'tsx',format:'cjs',jsx:'transform'}).code,module={exports:{} as any};
 new Function('require','module','exports',code)((name:string)=>{if(!(name in mocks))throw Error(name);return mocks[name]},module,module.exports);
 let tree:any;const render=()=>{cursor=0;tree=module.exports.AgentNameForm({conversation})};
 const nodes=(node:any):any[]=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
 const find=(type:string)=>nodes(tree).find(n=>n.type===type);
 const flush=async()=>{for(let i=0;i<3;i++){while(effects.length)effects.shift()!();await new Promise(r=>setImmediate(r));render()}};
 render();return{render,flush,set:(value:string)=>{find('Field').props.onChangeText(value);render()},save:()=>find('Save').props.onSave(),saveProps:()=>find('Save').props,cancel:()=>nodes(tree).find(n=>n.type===Button).props.onPress(),resolve:()=>resolve(),reject:()=>reject(Error('Write failed')),field:()=>find('Field').props.value,back:()=>back,calls:()=>calls,guard:()=>guard,refreshes:()=>refreshes,renameExternally:(name:string)=>{conversation.name=name;render()}};
}
test('cancel and blank drafts never write; external auto-title changes do not replace a user draft',async()=>{
 const f=form();await f.flush();f.set('');assert.equal(f.saveProps().canSave,false);f.save();assert.equal(f.calls(),0);
 f.set('My draft');f.renameExternally('An automatic title');assert.equal(f.field(),'My draft');f.cancel();assert.equal(f.back(),1);assert.equal(f.calls(),0);
});
test('duplicate saves are blocked; errors keep the draft and a confirmed retry refreshes before returning',async()=>{
 const f=form();await f.flush();f.set('Custom title');f.save();f.save();f.render();assert.equal(f.calls(),1);assert.equal(f.guard(),true);f.reject();await f.flush();assert.equal(f.field(),'Custom title');assert.equal(f.back(),0);assert.equal(f.guard(),false);
 f.save();f.resolve();await f.flush();assert.equal(f.calls(),2);assert.equal(f.refreshes(),1);assert.equal(f.back(),1);assert.equal(f.guard(),false);
});
