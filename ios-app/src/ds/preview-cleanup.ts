/** Only opaque handles returned by our native preview store. Failed removals retain ownership. */
export interface PreviewRemovalAPI {removePreviewFile:(id:string)=>Promise<boolean>}
const validId=(id:string)=>/^dsbot-preview-[\da-f-]{36}\.(png|jpg|webp)$/iu.test(id);
type Wait=(ms:number)=>Promise<void>;
const pause:Wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function createRemover(api:PreviewRemovalAPI,accept:(id:string)=>boolean,wait:Wait){
 const pending=new Map<string,{running?:Promise<boolean>}>();
 const listeners=new Set<(id:string)=>void>();
 let waiters=0,recovering=false,recoveryTimer:ReturnType<typeof setTimeout>|undefined;
 function scheduleRecovery(){if(waiters&&pending.size&&!recovering&&recoveryTimer===undefined)recoveryTimer=setTimeout(()=>{recoveryTimer=undefined;recover()},1000);}
 // Admission can be blocked by these very handles. Recovery must not depend on
 // reaching createPreviewFile, or on the app entering the foreground again.
 function recover(){
  if(!waiters||recovering||!pending.size)return;
  recovering=true;
  void Promise.all([...pending.keys()].map(remove)).finally(()=>{
   recovering=false;
   scheduleRecovery();
  });
 }
 function remove(id:string):Promise<boolean>{
  if(!accept(id))return Promise.resolve(false);
  let entry=pending.get(id);if(!entry){entry={};pending.set(id,entry);}
  if(entry.running)return entry.running;
  const owned=entry;
  owned.running=(async()=>{
   for(const delay of [0,50,250,1000]){
    if(delay)await wait(delay);
    try{if(await api.removePreviewFile(id)===true){pending.delete(id);for(const listener of listeners){try{listener(id)}catch{}}return true;}}catch{}
   }
   return false;
  })().finally(()=>{owned.running=undefined;scheduleRecovery();});
  return owned.running;
 }
 return{remove,subscribe:(listener:(id:string)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},retryPending:async()=>{await Promise.all([...pending.keys()].map(remove));return pending.size===0;},
  recoverWhileWaiting:()=>{waiters++;if(recoveryTimer===undefined)recover();let active=true;return()=>{if(!active)return;active=false;if(--waiters===0){clearTimeout(recoveryTimer);recoveryTimer=undefined;}}},
  get pending(){return pending.size;}};
}
export const createPreviewRemover=(api:PreviewRemovalAPI,wait:Wait=pause)=>createRemover(api,validId,wait);
export const createResponseRemover=(api:PreviewRemovalAPI,wait:Wait=pause)=>createRemover(api,id=>/^dsbot-response-[\da-f-]{36}$/iu.test(id),wait);
const stores=new WeakMap<PreviewRemovalAPI,ReturnType<typeof createPreviewRemover>>();
export function previewRemover(api:PreviewRemovalAPI){let store=stores.get(api);if(!store){store=createPreviewRemover(api);stores.set(api,store);}return store;}
