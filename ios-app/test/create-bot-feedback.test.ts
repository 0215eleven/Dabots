import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {nameProblem} from '../sdk/index.js';
import {mutationProblem} from '../src/ds/screen-binding.ts';
import {DsCoreError} from '../src/ds/contracts.ts';
const {transformSync}=createRequire(import.meta.url)('esbuild');
function fixture(){
 let cursor=0,back=0;const slots:any[]=[],alerts:string[][]=[],calls:any[]=[];
 let action:()=>Promise<unknown>=async()=>{throw Error('Configure the DSH model on the computer first.');};
 const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),
  useState(initial:any){const n=cursor++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return [slots[n],(v:any)=>{slots[n]=typeof v==='function'?v(slots[n]):v}]},
  useRef(initial:any){const n=cursor++;return slots[n]??(slots[n]={current:initial})}};
 const state={online:true,view:{serverId:'A',readOnly:null as string|null,bots:[{name:'Existing'}],capabilities:{actions:['create-bot'] as string[]}},commands:{createBot:async(input:any)=>{calls.push(input);return action()}}};
 const tr=(key:string,params?:Record<string,string>)=>key.replace(/\{(\w+)\}/g,(match,key)=>params?.[key]??match);
 const mocks:any={react,'react-native':{Alert:{alert:(...args:string[])=>alerts.push(args)}},'expo-router/react-navigation':{usePreventRemove:()=>{}},'expo-router':{router:{back:()=>{back++}}},
  '@ds/text':{tr,useDsText:()=>({tr})},'./text':{tr},'./screen-binding':{mutationProblem},'@ds/screen-binding':{mutationProblem},'@ds/provider':{useDs:()=>state},'@ds-bot/mobile-sdk':{nameProblem},
  'heroui-native':{Typography:{Paragraph:'Paragraph'}},'@openbot/brand/bloub-avatar':{avatarHueSwatch:()=>''},
  '@/features/agents/components/agent-appearance-picker':{AgentAppearancePicker:'Appearance'},'@/shared/components/sheet-form-field':{SheetFormField:'Field'},'@/shared/components/sheet-scroll-view':{SheetScrollView:'Scroll'},'@/shared/components/sheet-save-action':{SheetSaveAction:'Save'},'@ds/model-fields':{DsModelFields:'Models'}};
 function load(path:string){const code=transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code,module={exports:{} as any};new Function('require','module','exports','React',code)((name:string)=>{if(!(name in mocks))throw Error(name);return mocks[name]},module,module.exports,react);return module.exports;}
 mocks['@ds/form-state']=load('../src/ds/form-state.tsx');
 const screen=load('../openbot/mobile/src/features/agents/screens/add-agent-screen.tsx');let tree:any;
 const render=()=>{cursor=0;tree=screen.AddAgentScreen()};
 function nodes(x:any):any[]{if(Array.isArray(x))return x.flatMap(nodes);return x&&typeof x==='object'?[x,...Object.values(x.props??{}).flatMap(nodes)]:[]}
 const find=(type:string,label?:string)=>nodes(tree).find(n=>n.type===type&&(!label||n.props.label===label));
 render();
 return {state,alerts,calls,back:()=>back,render,action:(next:()=>Promise<unknown>)=>{action=next},name:(value:string)=>{find('Field','Bot name').props.onChangeText(value);render()},save:()=>find('Save').props.onSave(),saveProps:()=>find('Save').props,text:()=>JSON.stringify(tree),flush:async()=>{await new Promise(r=>setTimeout(r,5));render()}};
}
test('create failure is announced immediately, retains the draft and allows a corrected retry',async()=>{
 const f=fixture();f.name('  New Bot  ');f.save();await f.flush();
 assert.equal(f.alerts.length,1);assert.match(f.alerts[0][1],/Configure the DSH model/);assert.match(f.text(),/Configure the DSH model/);assert.match(f.text(),/  New Bot  /);assert.equal(f.back(),0);
 f.action(async()=>({status:'confirmed'}));f.save();await f.flush();assert.equal(f.back(),1);assert.equal(f.calls.at(-1).name,'New Bot');
});
test('missing, invalid and duplicate names explain disabled creation without a remote write',()=>{
 const f=fixture();assert.equal(f.saveProps().canSave,false);assert.match(f.text(),/A Bot needs a name/);
 for(const [name,reason] of [['@bad','cannot contain'],['existing','already exists'],['x'.repeat(41),'40 characters']]){f.name(name);assert.equal(f.saveProps().canSave,false);assert.ok(f.text().includes(reason));}
 f.name('有效名字');assert.equal(f.saveProps().canSave,true);assert.equal(f.calls.length,0);
});
test('offline and revoked creation access have a visible explanation',()=>{
 const f=fixture();f.name('New');f.state.online=false;f.render();assert.equal(f.saveProps().canSave,false);assert.match(f.text(),/offline/);
 f.state.online=true;f.state.view.capabilities.actions=[];f.render();assert.equal(f.saveProps().canSave,false);assert.match(f.text(),/not allowed/);
});
test('uncertain creation warns against retry and never dispatches a duplicate',async()=>{
 const f=fixture();f.name('Maybe created');f.action(async()=>{throw new DsCoreError('MUTATION_UNCONFIRMED','reply lost')});f.save();f.save();await f.flush();
 assert.equal(f.calls.length,1);assert.equal(f.alerts.length,1);assert.match(f.alerts[0][1],/may already exist/);assert.equal(f.saveProps().canSave,false);f.save();await f.flush();assert.equal(f.calls.length,1);assert.equal(f.back(),0);
});
test('an empty upstream error still leaves a useful failure message after closing the alert',async()=>{
 const f=fixture();f.name('New');f.action(async()=>{throw Error('')});f.save();await f.flush();assert.match(f.alerts[0][1],/did not provide a failure reason/);assert.match(f.text(),/did not provide a failure reason/);assert.equal(f.back(),0);
});
