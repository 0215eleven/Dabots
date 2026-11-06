import type {QueryCache} from '@tanstack/react-query';
import {previewRemover} from './preview-cleanup.ts';
export interface PreviewResource {uri:string;dispose:()=>Promise<boolean>}
export interface PreviewFileAPI {createPreviewFile:(input:{base64:string;mimeType:string})=>Promise<{id:string;uri:string}>;removePreviewFile:(id:string)=>Promise<boolean>}
const resources=new WeakMap<object,PreviewResource>(),watched=new WeakSet<QueryCache>();
export function ownPreviewData<T extends object>(data:T,resource:PreviewResource|null){if(resource)resources.set(data,resource);return data;}
/** QueryCache already owns observer reference counts, including a card and its viewer. */
export function watchPreviewCache(cache:QueryCache){
 if(watched.has(cache))return;watched.add(cache);const held=new WeakMap<object,PreviewResource>();
 cache.subscribe(event=>{
  const query=event.query;if(query.meta?.dsPrivatePreview!==true)return;
  const data=query.state.data,current=event.type==='removed'?undefined:data&&typeof data==='object'?resources.get(data):undefined,previous=held.get(query);
  if(previous&&previous!==current)void previous.dispose();
  if(current)held.set(query,current);else held.delete(query);
 });
}
export async function materializePreview(api:PreviewFileAPI|null,data:{base64:string;mimeType:string},signal?:AbortSignal):Promise<PreviewResource|null>{
 if(!api)return null;signal?.throwIfAborted();
 if(!['image/png','image/jpeg','image/webp'].includes(data.mimeType)||!data.base64.length||data.base64.length>1398104)throw Error('This image preview is unavailable.');
 const cleanup=previewRemover(api);await cleanup.retryPending();signal?.throwIfAborted();
 // Native [String:String] conversion checks every value; keep UI metadata in JS.
 const file=await api.createPreviewFile({base64:data.base64,mimeType:data.mimeType});let disposed=false;
 const dispose=async()=>{signal?.removeEventListener('abort',onAbort);if(disposed)return true;disposed=await cleanup.remove(file.id);return disposed;};
 const onAbort=()=>{void dispose();};
 if(!/^dsbot-preview-[\da-f-]{36}\.(png|jpg|webp)$/iu.test(file.id)||!file.uri.startsWith('file://')||!file.uri.endsWith('/'+file.id)||/[?#]/u.test(file.uri)){await dispose();throw Error('This image preview is unavailable.');}
 signal?.addEventListener('abort',onAbort,{once:true});
 if(signal?.aborted){await dispose();signal.throwIfAborted();}
 return {uri:file.uri,dispose};
}
