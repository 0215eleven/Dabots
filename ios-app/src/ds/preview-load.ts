import {createPreviewBudget,previewBudget,PreviewCapacityError,type PreviewLease} from './preview-budget.ts';
import {materializePreview,ownPreviewData,retainedPreview,type PreviewFileAPI,type PreviewResource} from './preview-resource.ts';
type Data={name:string;mimeType:string;base64:string;dimensions?:{width:number;height:number}};
const allocations=new WeakMap<PreviewResource,PreviewLease>();
const nativeCapacity=(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&String(error.code)==='ERR_DS_PREVIEW_CAPACITY';
function waitForChange(budget:ReturnType<typeof createPreviewBudget>,signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{
 const cleanup=()=>{clearTimeout(timer);unsubscribe();signal?.removeEventListener('abort',abort);},done=()=>{cleanup();resolve();},abort=()=>{cleanup();reject(signal?.reason);};
 const unsubscribe=budget.subscribe(done),timer=setTimeout(done,1000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});}
/** Reserve before downloading: queued work holds no image/Base64 and never fetches a whole original. */
export async function loadPrivatePreview(api:PreviewFileAPI|null,read:()=>Promise<Data>,options:{signal?:AbortSignal;previous?:PreviewResource;budget?:ReturnType<typeof createPreviewBudget>}={}){
 const budget=options.budget??previewBudget,signal=options.signal;
 const lease=await budget.acquire({signal,replace:options.previous?allocations.get(options.previous):undefined});let resource:PreviewResource|undefined;
 const own=(value:PreviewResource)=>{resource=value;allocations.set(value,lease);value.onDeleted(()=>lease.release());};
 try{
  const data=await read();signal?.throwIfAborted();
  if(!['image/png','image/jpeg','image/webp'].includes(data.mimeType)||!data.base64.length||data.base64.length>1398104)throw Error('This image preview is unavailable.');
  if(api){
   for(let attempt=0;;attempt++){
    try{await materializePreview(api,data,signal,own);break;}catch(error){signal?.throwIfAborted();if(!nativeCapacity(error))throw error;if(attempt>=14)throw new PreviewCapacityError();await waitForChange(budget,signal);}
   }
  }else{own(retainedPreview(`data:${data.mimeType};base64,${data.base64}`,async()=>true,signal).resource);}
  signal?.throwIfAborted();
  return ownPreviewData({...data,base64:'',fileUri:resource!.uri},resource!);
 }catch(error){if(resource)await resource.dispose();else lease.release();throw error;}
}
