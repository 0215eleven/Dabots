export const PREVIEW_BUDGET={resident:14,files:16,bytes:16*1048576,perFile:1048576,waiters:32,timeout:15000} as const;
export class PreviewCapacityError extends Error{readonly code='PREVIEW_CAPACITY';constructor(){super('Image previews are busy. Please wait or retry.');}}
export interface PreviewLease{release:()=>void;readonly live:boolean}
export function createPreviewBudget(limits:{resident:number;files:number;bytes:number;perFile:number;waiters:number;timeout:number}=PREVIEW_BUDGET){
 const leases=new Set<PreviewLease>(),listeners=new Set<()=>void>();
 type Waiter={replace?:PreviewLease;start:()=>void;reject:(error:unknown)=>void};const queue:Waiter[]=[];
 const fits=(entry:Waiter)=>leases.size*limits.perFile+limits.perFile<=limits.bytes&&leases.size<(entry.replace&&leases.has(entry.replace)&&entry.replace.live?limits.files:limits.resident);
 const notify=()=>{for(const listener of listeners){try{listener()}catch{}}};
 function drain(){for(let i=0;i<queue.length;){const entry=queue[i];if(fits(entry)){queue.splice(i,1);entry.start();i=0;}else i++;}}
 function acquire(options:{signal?:AbortSignal;replace?:PreviewLease}={}):Promise<PreviewLease>{
  options.signal?.throwIfAborted();if(queue.length>=limits.waiters)return Promise.reject(new PreviewCapacityError());
  return new Promise((resolve,reject)=>{
   let timer:ReturnType<typeof setTimeout>|undefined,settled=false;
   const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);};
   const stop=(error:unknown)=>{if(settled)return;settled=true;cleanup();const at=queue.indexOf(entry);if(at>=0)queue.splice(at,1);reject(error);};
   const abort=()=>stop(options.signal?.reason??new Error('The request was cancelled.'));
   const entry:Waiter={replace:options.replace,reject:stop,start:()=>{if(settled)return;settled=true;cleanup();let live=true;
    const lease:PreviewLease={get live(){return live},release:()=>{if(!live)return;live=false;leases.delete(lease);drain();notify();}};leases.add(lease);resolve(lease);
   }};
   queue.push(entry);options.signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>stop(new PreviewCapacityError()),limits.timeout);drain();
  });
 }
 return {acquire,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},get used(){return leases.size},get waiting(){return queue.length},get reservedBytes(){return leases.size*limits.perFile},get available(){return leases.size<limits.resident}};
}
export const previewBudget=createPreviewBudget();
