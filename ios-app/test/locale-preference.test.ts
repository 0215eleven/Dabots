import test from 'node:test';
import assert from 'node:assert/strict';
import {saveLocalePreference} from '../src/logic/locale-preference.ts';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {mutationProblem} from '../src/ds/screen-binding.ts';
import {DsCoreError} from '../src/ds/contracts.ts';

// Execute the actual Settings component and picker handlers with persistent hook
// slots. Controlled storage supplies the asynchronous ordering; no save logic is copied.
function settingsFixture(read: (scope:string,key:string)=>Promise<Record<string,unknown>|null>, write:(scope:string,key:string,value:unknown)=>Promise<void>) {
  const {transformSync}=createRequire(import.meta.url)('esbuild');
  const slots:any[]=[];let index=0,locale='host';
  const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),
    useRef:(value:any)=>{const id=index++;return slots[id]??(slots[id]={current:value});},
    useState:(initial:any)=>{const id=index++;if(!(id in slots))slots[id]=initial;return [slots[id],(value:any)=>{slots[id]=typeof value==='function'?value(slots[id]):value;}];},
    useEffect:()=>{index++;}};
  const Picker=Object.assign(()=>{}, {Item:'PickerItem'}),Button=Object.assign(()=>{},{Label:'ButtonLabel'});
  const mocks:Record<string,any>={react,
    'react-native':{Platform:{OS:'web'},View:'View',Pressable:'Pressable',Alert:{}},
    'heroui-native':{Button,Typography:{Paragraph:'Paragraph'}},'@expo/ui':{Host:'UiHost',Picker,Switch:'Switch'},
    'expo-constants':{expoConfig:{}},'expo-router':{Stack:{Screen:'Screen'},useRouter:()=>({})},
    '@/shared/components/large-title':{LargeTitleScrollView:'LargeTitleScrollView'},
    '@/features/settings/components/settings-content':{SettingsSection:'Section',SettingsRow:'Row'},
    '../src/logic/hosts':{hostAddress:()=> 'isolated host'},
    '../src/i18n':{useI18n:()=>({tr:(key:string)=>`${locale}|${key}`,locale:locale==='zh'?'zh':'en',preference:locale}),setLocalePreference:(value:string)=>{locale=value;}},
    '../src/session/SessionProvider':{useSession:()=>({host:{serverId:'A'},hosts:[],workspace:{online:true}})},
    '../src/ds/provider':{useDs:()=>({view:{preferences:{},capabilities:{actions:['set-prefs']}},commands:{setPreferences:async()=>{throw new DsCoreError('MUTATION_UNCONFIRMED','isolated management failure');}}})},
    '../src/ds/screen-binding':{mutationProblem},'../src/theme':{useColorMode:()=> 'system',THEMES:{}},
    '../src/storage':{readCache:read,writeCache:write},'../src/logic/locale-preference':{saveLocalePreference},
    '../src/media/haptics':{selectionFeedback:()=>{}},
  };
  const module={exports:{} as any};
  const code=transformSync(readFileSync(new URL('../app/settings.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code;
  new Function('require','module','exports',code)((name:string)=>mocks[name]??{},module,module.exports);
  const render=()=>{index=0;const route=module.exports.default();return route.type();};
  function nodes(x:any):any[]{if(Array.isArray(x))return x.flatMap(nodes);return x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];}
  function strings(x:any):string[]{if(Array.isArray(x))return x.flatMap(strings);return typeof x==='string'?[x]:x&&typeof x==='object'?strings(x.props?.children):[];}
  return {
    select:(value:string)=>{const picker=nodes(render()).find(x=>x.type===Picker&&nodes(x).some(c=>c.props?.value==='zh'));assert.ok(picker);picker.props.onValueChange(value);},
    managementFailure:()=>{const button=nodes(render()).find(x=>x.type===Button&&strings(x).includes('#228866'));assert.ok(button);button.props.onPress();},
    texts:()=>strings(render()),
  };
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
const warning='Language changed for this session, but could not be saved on this device.';
const managementWarning=mutationProblem(new DsCoreError('MUTATION_UNCONFIRMED','isolated')).message;
test('locale round trips preserve host isolation, follow modes and unrelated original preferences', async () => {
  const records = new Map<string, Record<string, unknown>>([['A/mobile-preferences', {classic:true, locale:'en'}], ['B/mobile-preferences',{locale:'system'}]]);
  const storage = {read:async(s:string,k:string)=>records.get(s+'/'+k)??null, write:async(s:string,k:string,v:unknown)=>{records.set(s+'/'+k,v as any);}};
  for(const locale of ['zh','en','host','system'] as const){await saveLocalePreference(storage,'A',locale);assert.deepEqual(records.get('A/mobile-preferences'),{classic:true,locale});assert.deepEqual(records.get('B/mobile-preferences'),{locale:'system'});}
});
test('a silent browser write failure and a strict read failure cannot report persistence', async () => {
  await assert.rejects(saveLocalePreference({read:async()=>({locale:'en'}),write:async()=>{}},'A','zh'), /could not be saved/);
  let writes=0;
  await assert.rejects(saveLocalePreference({read:async()=>{throw Error('unread');},write:async()=>{writes++;}},'A','zh'),/unread/);
  assert.equal(writes,0);
});

test('actual Settings ignores an older delayed failure after a newer successful locale selection',async()=>{
  let rejectOld!:(error:Error)=>void,reads=0;const writes:unknown[]=[];
  const held=new Promise<Record<string,unknown>|null>((_,reject)=>{rejectOld=reject;});
  const records=new Map([['A',{classic:true,locale:'host'}],['B',{classic:false,locale:'zh'}]]);
  const settings=settingsFixture(async(scope,key)=>{assert.equal(key,'mobile-preferences');return ++reads===1?held:records.get(scope)??null;},async(scope,key,value)=>{assert.equal(key,'mobile-preferences');writes.push([scope,value]);records.set(scope,value as any);});
  settings.select('zh');await settle();settings.select('en');rejectOld(Error('delayed old read denial'));await settle();await settle();
  assert.deepEqual(records.get('A'),{classic:true,locale:'en'});assert.deepEqual(records.get('B'),{classic:false,locale:'zh'});
  assert.deepEqual(writes,[['A',{classic:true,locale:'en'}]]);
  assert.equal(settings.texts().some(text=>text.includes(warning)),false);
});

test('actual Settings retains management errors during locale changes and shows only the current locale failure',async()=>{
  let denied=true;const records=new Map<string,Record<string,unknown>>([['A',{classic:true,locale:'host'}]]);
  const settings=settingsFixture(async scope=>{if(denied)throw Error('current read denial');return records.get(scope)??null;},async(scope,_key,value)=>{records.set(scope,value as any);});
  settings.managementFailure();await settle();assert.ok(settings.texts().includes('host|'+managementWarning));
  settings.select('zh');assert.ok(settings.texts().includes('zh|'+managementWarning));await settle();
  assert.ok(settings.texts().includes('zh|'+warning));assert.ok(settings.texts().includes('zh|'+managementWarning));
  denied=false;settings.select('en');await settle();await settle();
  assert.deepEqual(records.get('A'),{classic:true,locale:'en'});
  assert.equal(settings.texts().some(text=>text.includes(warning)),false);assert.ok(settings.texts().includes('en|'+managementWarning));
});
