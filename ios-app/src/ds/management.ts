import type {DsCore} from './contracts.ts';
import {DsCoreError} from './contracts.ts';
import {mutationProblem} from './screen-binding.ts';
export interface ManagementIssue {key:string;message:string;acknowledged:boolean;acknowledgement?:unknown}
interface State {pending:Set<string>;issues:Map<string,ManagementIssue>;listeners:Set<()=>void>}
const owners=new WeakMap<object,State>();
const pairings=new Map<string,State>();
/** Nonsecret server/pairing ownership survives fresh clients after switching hosts.
 * In-memory review state only: no mutation journal, replay, credentials or backend. */
export function guardManagement(core:DsCore,owner:object|string){
 const states = (typeof owner === 'string' ? pairings : owners) as Map<object|string,State>;
 let state=states.get(owner);if(!state){state={pending:new Set(),issues:new Map(),listeners:new Set()};states.set(owner,state)}
 const owned=state;
 const notify=()=>{for(const listener of owned.listeners)listener()};
 async function run<T>(key:string,action:()=>Promise<T>):Promise<T>{
  core.read();
  const issue=owned.issues.get(key);
  if(issue)throw new DsCoreError(issue.acknowledged?'READBACK_FAILED':'MUTATION_UNCONFIRMED',issue.message,{mutation:issue.acknowledged?'acknowledged':'unknown',acknowledgement:issue.acknowledgement});
  if(owned.pending.has(key))throw new DsCoreError('INVALID_INPUT','This operation is already pending.');
  owned.pending.add(key);notify();
  try{return await action()}catch(error){const problem=mutationProblem(error);if(!problem.retry){owned.issues.set(key,{key,message:problem.message,acknowledgement:error&&typeof error==='object'&&'acknowledgement'in error?error.acknowledgement:undefined,acknowledged:!!error&&typeof error==='object'&&'code'in error&&error.code==='READBACK_FAILED'});notify()}throw error}finally{owned.pending.delete(key);notify()}
 }
 const protectedCore:DsCore={...core,
  createBot:input=>run('createBot',()=>core.createBot(input)),updateBot:(id,input)=>run(`updateBot:${id}`,()=>core.updateBot(id,input)),
  duplicateBot:id=>run(`duplicateBot:${id}`,()=>core.duplicateBot(id)),deleteBot:id=>run(`deleteBot:${id}`,()=>core.deleteBot(id)),setMainBot:(id,input)=>run(`setMainBot:${id}`,()=>core.setMainBot(id,input)),
  createGroup:input=>run('createGroup',()=>core.createGroup(input)),updateGroup:(id,input)=>run(`updateGroup:${id}`,()=>core.updateGroup(id,input)),deleteGroup:id=>run(`deleteGroup:${id}`,()=>core.deleteGroup(id)),
  setFlags:(id,input)=>run(`setFlags:${id}`,()=>core.setFlags(id,input)),setPreferences:input=>run('setPreferences',()=>core.setPreferences(input)),
  cancel:id=>run(`cancel:${id}`,()=>core.cancel(id)),stopGroupMember:(id,botId)=>run(`stopGroupMember:${id}:${botId}`,()=>core.stopGroupMember(id,botId)),
 };
 return{core:protectedCore,issues:()=>[...owned.issues.values()],subscribe:(listener:()=>void)=>{owned.listeners.add(listener);return()=>{owned.listeners.delete(listener)}},
  /** Explicit review flow: first read current canonical desktop state, then user acknowledges it. */
  async review(){await core.refresh();core.read();return [...owned.issues.values()]},
  acknowledge(reviewed:ManagementIssue[]){core.read();for(const issue of reviewed)if(owned.issues.get(issue.key)===issue)owned.issues.delete(issue.key);notify()},
 };
}
