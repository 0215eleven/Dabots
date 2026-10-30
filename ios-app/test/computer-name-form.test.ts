import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {normalizeComputerName} from '../src/logic/computer-names.ts';
const {transformSync}=createRequire(import.meta.url)('esbuild');
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function form(){
 let cursor=0,guard=false,back=0,calls=0;
 let resolve!:()=>void,reject!:(error:Error)=>void;
 const slots:any[]=[],effects:Array<()=>void>=[];
 const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),
  useState(initial:any){const n=cursor++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return [slots[n],(v:any)=>{slots[n]=typeof v==='function'?v(slots[n]):v}]},
  useRef(initial:any){const n=cursor++;return slots[n]??(slots[n]={current:initial})},
  useEffect(effect:any,deps:any[]){const n=cursor++,previous=slots[n];if(previous&&deps.length===previous.length&&deps.every((v,i)=>Object.is(v,previous[i])))return;slots[n]=deps;effects.push(effect)}
 };
 const router={back:()=>{assert.equal(guard,false,'release navigation protection before leaving a successful save');back++}};
 const api={name:()=> 'Original',load:async()=>{},rename:async()=>{calls++;await new Promise<void>((yes,no)=>{resolve=yes;reject=no})}};
 const Button=Object.assign('Button',{Label:'Label'}),Toolbar=Object.assign('Toolbar',{Button:'ToolbarButton'});
 const mocks:any={react,'react-native':{Platform:{OS:'web'},View:'View'},'expo-router':{useRouter:()=>router,Stack:{Toolbar}},
  'expo-router/react-navigation':{usePreventRemove:(value:boolean)=>{guard=value}},'heroui-native':{Button,Typography:{Paragraph:'Paragraph'}},
  '@/shared/components/sheet-scroll-view':{SheetScrollView:'Scroll'},'@/shared/components/sheet-form-field':{SheetFormField:'Field'},'@/shared/components/sheet-save-action':{SheetSaveAction:'Save'},
  '../src/names/ComputerNamesProvider':{useComputerNames:()=>api},'../src/session/SessionProvider':{},'../src/i18n':{useI18n:()=>({tr:(v:string)=>v})},'../src/logic/hosts':{},'../src/logic/computer-names':{normalizeComputerName}};
 const source=readFileSync(new URL('../app/computer-name.tsx',import.meta.url),'utf8')+'\nexport {NameForm};';
 const code=transformSync(source,{loader:'tsx',format:'cjs',jsx:'transform'}).code,module={exports:{} as any};
 new Function('require','module','exports',code)((name:string)=>{if(!(name in mocks))throw Error(name);return mocks[name]},module,module.exports);
 let tree:any;
 const render=()=>{cursor=0;tree=module.exports.NameForm({host:{serverId:'A',slot:'a',name:'Original'}});return tree};
 function nodes(value:any):any[]{return Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[]}
 const find=(type:string)=>nodes(tree).find(node=>node.type===type);
 const flush=async()=>{for(let i=0;i<4;i++){while(effects.length)effects.shift()!();await tick();render()}};
 render();
 return {flush,render,set:(value:string)=>{find('Field').props.onChangeText(value);render()},save:()=>find('Save').props.onSave(),resolve:()=>resolve(),reject:()=>reject(Error('write failed')),guard:()=>guard,back:()=>back,calls:()=>calls,field:()=>find('Field').props.value,text:()=>JSON.stringify(tree)};
}
test('pending nickname saves prevent dismissal and duplicates; failure retains the draft and error',async()=>{
 const f=form();await f.flush();f.set('New name');f.save();f.render();assert.equal(f.guard(),true);
 f.save();assert.equal(f.calls(),1);f.reject();await f.flush();
 assert.equal(f.guard(),false);assert.equal(f.field(),'New name');assert.ok(f.text().includes('write failed'));assert.equal(f.back(),0);
});
test('a confirmed nickname save releases the navigation guard before closing once',async()=>{
 const f=form();await f.flush();f.set('New name');f.save();f.render();assert.equal(f.guard(),true);f.resolve();await f.flush();
 assert.equal(f.guard(),false);assert.equal(f.back(),1);
});
