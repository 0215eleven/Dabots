// Explicit development-only integration fixture. Never enabled by design-preview alone.
import type {MobileClient,Conversation} from '@ds-bot/mobile-sdk';
import type {TeamState} from '../types';
export const enabledFixture = __DEV__ && process.env.EXPO_PUBLIC_DS_BOT_ENABLED_FIXTURE === '1' && process.env.EXPO_PUBLIC_DS_BOT_DESIGN_PREVIEW === '1';
export interface FixtureControl {
 calls:Array<{action:string;body:Record<string,unknown>}>;
 team:TeamState;
 lose(action:string):void;
 refresh?:()=>Promise<unknown>;
 replaceHost?:()=>void;
 menus:Map<string,()=>void>;
}
export let fixtureControl:FixtureControl | undefined;
export function enableFixture(client:MobileClient,seed:TeamState,source:Conversation[],serverId='preview'):MobileClient {
 if(!enabledFixture)return client;
 const team=structuredClone(seed),conversations=structuredClone(source);let lose='';let next=0;
 team.models=[{ref:'dsh/vendor:model',name:'DSH Model One'},{ref:'dsh/custom:next',name:'DSH Model Two'}];
 team.rooms[0]={...team.rooms[0],notice:'Desktop notice A',mode:'admin',admin:'preview-research'};
 const control:FixtureControl={team,calls:[],menus:new Map(),lose(action){lose=action}};fixtureControl=control;
 Object.assign(globalThis,{__DS_TEST_FIXTURE__:control});
 return {...client,
 info:async()=>({serverId,capabilities:{history:true,stream:true,send:true,cancel:true,actions:['create-bot','update-bot','duplicate-bot','delete-bot','create-room','update-room','delete-room','set-flags','set-prefs','set-main','efforts']}}),
 state:async()=>structuredClone(team),conversations:async()=>({conversations:structuredClone(conversations)}),
 action:async(action:string,body:Record<string,unknown>={})=>{
  control.calls.push({action,body:structuredClone(body)});
  if(action==='efforts')return{efforts:[{id:'host/very-deep',name:'Host Deep'},{id:'host/auto-42',name:'Host Auto'}]};
  const bot=team.bots.find(b=>b.id===body.id),room=team.rooms.find(r=>r.id===body.id);let id=String(body.id??'');
  if(action==='create-bot'||action==='duplicate-bot'){id=`created-${++next}`;team.bots.push({...bot,...body,id,name:action==='duplicate-bot'?'Canonical duplicate':`Canonical ${body.name}`,sessionId:`s-${id}`});conversations.push({id,kind:'bot',name:team.bots.at(-1)!.name,sessionId:`s-${id}`})}
  if(action==='update-bot'&&bot)Object.assign(bot,body,body.name?{name:`Canonical ${body.name}`}:{ });
  if(action==='create-room'){id=`room-${++next}`;team.rooms.push({id,name:`Canonical ${body.name}`,members:body.members as string[],admin:body.admin as string});conversations.push({id,kind:'room',name:team.rooms.at(-1)!.name,sessionId:`s-${id}`})}
  if(action==='update-room'&&room)Object.assign(room,body,body.name?{name:`Canonical ${body.name}`}:{ });
  if(action==='set-prefs')team.prefs={...team.prefs,...body,...(body.accent?{accent:'#228866'}:{})};
  if(action==='set-flags')Object.assign(conversations.find(c=>c.id===body.id)??{},body);
  if(action==='delete-bot')team.bots=team.bots.filter(b=>b.id!==body.id);
  if(action==='delete-room')team.rooms=team.rooms.filter(r=>r.id!==body.id);
  if(lose===action){lose='';throw Error('Fixture lost response after desktop apply')}
  return{id,changed:true};
 },
 } as unknown as MobileClient;
}
