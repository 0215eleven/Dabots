import {useSharedValue} from 'react-native-reanimated';
import {useEffect,useRef,useState} from 'react';
import {File,Paths} from 'expo-file-system';
import type {MobileClient} from '@ds-bot/mobile-sdk';
import {useChatAttachments,type ChatAttachment} from '@/features/chat/components/use-chat-attachments';
import {useText} from '@/shared/lib/text';
import {useSession} from '../session/SessionProvider';
import {MOBILE_UPLOAD_LIMITS,LEGACY_UPLOAD_LIMITS,UploadSelectionError,uploadAttachments,uploadStreamedAttachments,validateSelectedUploads,uploadKind} from '../logic/upload-attachments';
import {selectionErrorMessage,uploadErrorMessage} from './attachment-selection-error';
import {prepareSelectedPhoto} from './prepare-photo';
import {copyDraftUpload,discardDraftUpload,readCachedChunk,createUploadId} from './attachment-files';
import type {LocalUpload} from './upload-types';

function discardLegacy(uri?:string){try{if(uri&&['DocumentPicker/','ImagePicker/'].some(folder=>uri.startsWith(Paths.cache.uri+folder))&&!decodeURIComponent(uri).includes('..'))new File(uri).delete();}catch{}}
export function useAttachments(){
 const text=useText(),{workspace}=useSession();
 const capabilities=workspace.team.mobileCapabilities;
 const large=workspace.online&&capabilities?.uploadTransfers===1;
 const limits=large?MOBILE_UPLOAD_LIMITS:LEGACY_UPLOAD_LIMITS;
 const active=useRef(true),selection=useRef(new AbortController()),owned=useRef(new Map<string,LocalUpload>());
 const controller=useRef<AbortController|null>(null),remote=useRef(new Map<string,{client:MobileClient;ids:Set<string>}>());
 const inlineIds=useRef(new Map<string,string>());
 const [uploading,setUploading]=useState(false),[progress,setProgress]=useState<{bytes:number;total:number;phase:'original'|'preview'}|null>(null);
 function selectionFailure(error:unknown):never{if(error instanceof UploadSelectionError)throw new Error(selectionErrorMessage(error,text,limits));throw error;}
 function discard(file:LocalUpload){owned.current.delete(file.clientId);discardDraftUpload(file);}
 function remember(file:LocalUpload){if(!active.current||selection.current.signal.aborted){discard(file);throw new Error(text.t('mobile.chat.attachment.unavailable'));}owned.current.set(file.clientId,file);return file;}
 async function photo(asset:Parameters<typeof prepareSelectedPhoto>[0]){
  try{const result=await prepareSelectedPhoto(asset,limits.maxBytes,selection.current.signal);remember(result.localFile);return result;}catch(error){return selectionFailure(error);}
 }
 async function file(uri:string,name:string){
  try{if(uploadKind(name)==='photo')return (await photo({uri,fileName:name})).localFile;return remember(await copyDraftUpload(uri,name,limits.maxBytes,selection.current.signal));}catch(error){return selectionFailure(error);}
 }
 const attachments=useChatAttachments([],async items=>{try{validateSelectedUploads(items,limits);}catch(error){selectionFailure(error);}},()=>({eml:false,media:false,zip:false,mp4:false}),{
  bytes:limits.maxBytes,count:limits.maxFiles,...(large?{file,photo,discardFile:discard}:{}),
 });
 const menuProgress=useSharedValue(0),previous=useRef(attachments.items);
 function releaseRemote(key:string){const transfer=remote.current.get(key);remote.current.delete(key);if(transfer)for(const id of transfer.ids)void transfer.client.removeTransfer(id).catch(()=>{});}
 const sourceId=(item:ChatAttachment)=>{if(item.localFile)return item.localFile.clientId;let id=inlineIds.current.get(item.id);if(!id){id=createUploadId();inlineIds.current.set(item.id,id);}return id;};
 useEffect(()=>{
  const held=new Set(attachments.items.map(item=>item.localFile?.uri??item.uri)),keys=new Set(attachments.items.map(sourceId));
  for(const item of previous.current){if(!held.has(item.localFile?.uri??item.uri)){if(item.localFile)discard(item.localFile);else discardLegacy(item.uri);}if(!keys.has(sourceId(item)))releaseRemote(sourceId(item));}
  previous.current=attachments.items;
 },[attachments.items]);
 useEffect(()=>{active.current=true;if(selection.current.signal.aborted)selection.current=new AbortController();return()=>{
  active.current=false;selection.current.abort();controller.current?.abort();for(const file of owned.current.values())discardDraftUpload(file);owned.current.clear();
  for(const item of previous.current)if(!item.localFile)discardLegacy(item.uri);for(const key of remote.current.keys())releaseRemote(key);
 };},[]);
 const photos=attachments.items.filter(item=>item.localFile?.kind==='photo');
 const notice=photos.length?text.t(photos.some(item=>item.localFile?.previewUnavailable)?'mobile.chat.attachment.originalOnly':'mobile.chat.attachment.originalPreview'):null;
 const statusLabel=progress?(progress.phase==='preview'?text.t('mobile.chat.attachment.uploadingPreview'):text.t('mobile.chat.attachment.uploadingOriginal',{progress:text.format.percent(progress.total?progress.bytes/progress.total:0)})):null;
 return {...attachments,menuProgress,preparing:attachments.preparing||uploading,uploading,progress,statusLabel,notice,
  cancelUpload:()=>controller.current?.abort(),
  // Queue ownership has moved to the outbox. Its receiving receipts survive clearing the composer.
  clearSent:()=>{for(const item of attachments.items)remote.current.delete(sourceId(item));attachments.clear();},
  restore:(files:readonly ChatAttachment[])=>{const existing=new Set(attachments.items.map(sourceId));attachments.restore(files.filter(item=>!existing.has(sourceId(item))));},
  async upload(client:MobileClient,conversationId:string){
   if(controller.current)throw Error('An upload is already in progress.');const request=new AbortController();controller.current=request;setUploading(true);setProgress(null);
   try{
    if(large||attachments.items.some(item=>item.localFile))return await uploadStreamedAttachments(client,conversationId,attachments.items.map(item=>({...item,id:sourceId(item)})),{signal:request.signal,read:readCachedChunk,
     onProgress:(bytes,total,phase)=>{if(active.current)setProgress({bytes,total,phase});},
     onTransfer:(key,id)=>{const transfer=remote.current.get(key)??{client,ids:new Set<string>()};transfer.ids.add(id);remote.current.set(key,transfer);},
    });
    return await uploadAttachments(client,conversationId,attachments.items,request.signal);
   }catch(error){
    if(error instanceof UploadSelectionError)throw new Error(selectionErrorMessage(error,text,limits));
    throw Object.assign(new Error(uploadErrorMessage(error,text)),error&&typeof error==='object'?{code:'code' in error?error.code:undefined,status:'status' in error?error.status:undefined}:{});
   }finally{controller.current=null;if(active.current){setUploading(false);setProgress(null);}}
  },
 };
}
