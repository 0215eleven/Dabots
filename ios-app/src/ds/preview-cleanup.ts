/** Only opaque handles returned by our native preview store. Failed removals retain ownership. */
export interface PreviewRemovalAPI {removePreviewFile:(id:string)=>Promise<boolean>}
const validId=(id:string)=>/^dsbot-preview-[\da-f-]{36}\.(png|jpg|webp)$/iu.test(id);
type Wait=(ms:number)=>Promise<void>;
const pause:Wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function createRemover(api:PreviewRemovalAPI,accept:(id:string)=>boolean,wait:Wait){
 const pending=new Map<string,{running?:Promise<boolean>}>();
 const listeners=new Set<(id:string)=>void>();
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
  })().finally(()=>{owned.running=undefined;});
  return owned.running;
 }
 return{remove,subscribe:(listener:(id:string)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},retryPending:async()=>{await Promise.all([...pending.keys()].map(remove));return pending.size===0;},get pending(){return pending.size;}};
}
export const createPreviewRemover=(api:PreviewRemovalAPI,wait:Wait=pause)=>createRemover(api,validId,wait);
export const createResponseRemover=(api:PreviewRemovalAPI,wait:Wait=pause)=>createRemover(api,id=>/^dsbot-response-[\da-f-]{36}$/iu.test(id),wait);
const stores=new WeakMap<PreviewRemovalAPI,ReturnType<typeof createPreviewRemover>>();
export function previewRemover(api:PreviewRemovalAPI){let store=stores.get(api);if(!store){store=createPreviewRemover(api);stores.set(api,store);}return store;}
