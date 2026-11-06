import type {QueryCache} from '@tanstack/react-query';
import {previewRemover} from './preview-cleanup.ts';
export interface PreviewResource {uri:string;dispose:()=>Promise<boolean>;retain:()=>()=>void;onDeleted:(listener:()=>void)=>()=>void}
export interface PreviewFileAPI {createPreviewFile:(input:{base64:string;mimeType:string})=>Promise<{id:string;uri:string}>;removePreviewFile:(id:string)=>Promise<boolean>}
const resources=new WeakMap<object,PreviewResource>(),watched=new WeakSet<QueryCache>();
export function ownPreviewData<T extends object>(data:T,resource:PreviewResource|null){if(resource)resources.set(data,resource);return data;}
export function previewResource(data:unknown){return data&&typeof data==='object'?resources.get(data):undefined;}
/** Cache ownership and committed image views are separate references; refresh never unlinks a displayed file. */
export function retainedPreview(uri:string,remove:()=>Promise<boolean>,signal?:AbortSignal){
 let refs=1,owner=true,deleted=false,running:Promise<boolean>|undefined;const listeners=new Set<()=>void>();
 const markDeleted=()=>{if(deleted)return;deleted=true;for(const listener of listeners)listener();listeners.clear();};
 const erase=()=>{if(deleted)return Promise.resolve(true);if(refs)return Promise.resolve(false);return running??=(async()=>{if(await remove()){markDeleted();return true;}return false;})().finally(()=>{running=undefined});};
 const dispose=()=>{if(owner){owner=false;refs--;signal?.removeEventListener('abort',abort);}return erase();};
 const abort=()=>{void dispose();};signal?.addEventListener('abort',abort,{once:true});
 const resource:PreviewResource={uri,dispose,
  retain:()=>{if(!owner||deleted)return()=>{};refs++;let active=true;return()=>{if(!active)return;active=false;refs--;void erase();}},
  onDeleted:listener=>{if(deleted){listener();return()=>{}}listeners.add(listener);return()=>{listeners.delete(listener)}},
 };
 return {resource,markDeleted};
}
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
export async function materializePreview(api:PreviewFileAPI|null,data:{base64:string;mimeType:string},signal?:AbortSignal,onResource?:(resource:PreviewResource)=>void):Promise<PreviewResource|null>{
 if(!api)return null;signal?.throwIfAborted();
 if(!['image/png','image/jpeg','image/webp'].includes(data.mimeType)||!data.base64.length||data.base64.length>1398104)throw Error('This image preview is unavailable.');
 const cleanup=previewRemover(api);await cleanup.retryPending();signal?.throwIfAborted();
 // Native [String:String] conversion checks every value; keep UI metadata in JS.
 const file=await api.createPreviewFile({base64:data.base64,mimeType:data.mimeType});
 const held=retainedPreview(file.uri,()=>cleanup.remove(file.id),signal),resource=held.resource;
 const unsubscribe=cleanup.subscribe(id=>{if(id===file.id)held.markDeleted();});resource.onDeleted(unsubscribe);onResource?.(resource);
 if(!/^dsbot-preview-[\da-f-]{36}\.(png|jpg|webp)$/iu.test(file.id)||!file.uri.startsWith('file://')||!file.uri.endsWith('/'+file.id)||/[?#]/u.test(file.uri)){await resource.dispose();throw Error('This image preview is unavailable.');}
 if(signal?.aborted){await resource.dispose();signal.throwIfAborted();}
 return resource;
}
