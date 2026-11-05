import {Directory,File,FileMode,Paths} from 'expo-file-system';
import {getRandomBytes} from 'expo-crypto';
import {Platform} from 'react-native';
import {sha256} from '@noble/hashes/sha2.js';
import {encode} from '@stablelib/base64';
import {attachmentMimeTypeForName} from '@openbot/contracts/attachment-files';
import {imageDimensions} from '@/features/chat/model/image-dimensions';
import {UploadSelectionError,uploadKind} from '../logic/upload-attachments';
import type {LocalUpload} from './upload-types';

const folder='DabotsUploadDrafts/',webCopies=new Set<string>();
const cached=new Map<string,number>();let swept=false;
function reserve(uri:string,size:number){if(cached.size>=16||[...cached.values()].reduce((sum,value)=>sum+value,0)+size>400000000)throw new UploadSelectionError('quota');cached.set(uri,size);}
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
export const createUploadId=()=>hex(getRandomBytes(16));
function inCache(uri:string,folder:string){try{return uri.startsWith(Paths.cache.uri+folder)&&!decodeURIComponent(uri).includes('..')&&!/[?#]/u.test(uri);}catch{return false;}}
function owned(uri:string){return inCache(uri,folder);}
function readable(uri:string){return owned(uri)||inCache(uri,'ImageManipulator/');}
export function discardDraftUpload(file:LocalUpload){
 for(const uri of new Set([file.uri,file.preview?.uri].filter((value):value is string=>!!value))){try{
  if(Platform.OS==='web'){if(webCopies.delete(uri))URL.revokeObjectURL(uri);cached.delete(uri);}
  else if(readable(uri)){const file=new File(uri);if(file.exists)file.delete();cached.delete(uri);}
 }catch{}}
}
export function safeUploadName(name:string){const clean=name.replace(/[\p{Cc}\p{Zl}\p{Zp}/\\:]/gu,'_').replace(/^\.+/u,'').trim(),dot=clean.lastIndexOf('.');return (dot>0?clean.slice(0,dot).slice(0,240)+clean.slice(dot):clean.slice(0,255))||'attachment';}
/** Copy a granted selection before a share-provider deletes its temporary original. */
export async function copyDraftUpload(uri:string,name:string,maximum:number,signal?:AbortSignal):Promise<LocalUpload>{
 name=safeUploadName(name);const kind=uploadKind(name);if(!kind)throw new UploadSelectionError('type',name);
 const clientId=createUploadId(),hash=sha256.create();let copiedUri:string|undefined;
 try{
  let size:number;
  if(Platform.OS==='web'){
   if(!uri.startsWith('blob:')&&!uri.startsWith('data:'))throw new UploadSelectionError('type',name);
   const blob=await(await fetch(uri,{signal})).blob();size=blob.size;
   if(size<=0||size>maximum)throw new UploadSelectionError(size<=0?'damaged':'size',name);
   copiedUri=URL.createObjectURL(blob);webCopies.add(copiedUri);reserve(copiedUri,size);
   for(let offset=0;offset<size;offset+=262144){signal?.throwIfAborted();hash.update(new Uint8Array(await blob.slice(offset,offset+262144).arrayBuffer()));}
  }else{
   if(!uri.startsWith('file://')&&!uri.startsWith('content://'))throw new UploadSelectionError('type',name);
   const source=new File(uri);size=source.size;const modified=source.modificationTime;
   if(size<=0||size>maximum)throw new UploadSelectionError(size<=0?'damaged':'size',name);
   const directory=new Directory(Paths.cache,folder);directory.create({idempotent:true,intermediates:true});
   // Selections are memory-only; after process restart, these private UUID copies are orphaned.
   if(!swept){for(const file of directory.list())if(file instanceof File&&/^[a-f0-9]{32}\.[a-z0-9]+$/u.test(file.name)&&!cached.has(file.uri))file.delete();swept=true;}
   const destination=new File(directory,`${clientId}.${name.split('.').at(-1)}`);copiedUri=destination.uri;reserve(copiedUri,size);destination.create();
   const input=source.open(FileMode.ReadOnly);let output:ReturnType<File['open']>|undefined;
   try{output=destination.open(FileMode.WriteOnly);for(let offset=0;offset<size;){signal?.throwIfAborted();const bytes=await input.readBytes(Math.min(262144,size-offset));
    if(!bytes.length)throw new UploadSelectionError('damaged',name);hash.update(bytes);await output.writeBytes(bytes);offset+=bytes.length;
   }}finally{try{input.close();}finally{output?.close();}}
   if(destination.size!==size||source.size!==size||source.modificationTime!==modified)throw new UploadSelectionError('damaged',name);
   // These folders contain picker-created copies, never the user's library/document originals.
   try{if(['ImagePicker/','DocumentPicker/'].some(folder=>uri.startsWith(Paths.cache.uri+folder))&&!decodeURIComponent(uri).includes('..'))source.delete();}catch{}
  }
  signal?.throwIfAborted();return {uri:copiedUri,name,mediaType:attachmentMimeTypeForName(name),size,clientId,sha256:hex(hash.digest()),owned:true,kind};
 }catch(error){if(copiedUri)discardDraftUpload({uri:copiedUri} as LocalUpload);throw error;}
}
export async function readCachedChunk(uri:string,size:number,offset:number,length:number){
 if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<1||length>262144||offset+length>size)throw new UploadSelectionError('damaged');
 if(Platform.OS==='web'){
  if(!uri.startsWith('blob:')&&!uri.startsWith('data:'))throw new UploadSelectionError('type');
  const blob=await(await fetch(uri)).blob();if(blob.size!==size)throw new UploadSelectionError('damaged');return new Uint8Array(await blob.slice(offset,offset+length).arrayBuffer());
 }
 if(!readable(uri))throw new UploadSelectionError('type');
 const file=new File(uri);if(file.size!==size)throw new UploadSelectionError('damaged');const handle=file.open(FileMode.ReadOnly);
 try{handle.offset=offset;return await handle.readBytes(length);}finally{handle.close();}
}
export async function inspectPhotoFile(uri:string){
 let size:number,header:Uint8Array;
 if(Platform.OS==='web'){if(!uri.startsWith('blob:')&&!uri.startsWith('data:'))throw new UploadSelectionError('type');const blob=await(await fetch(uri)).blob();size=blob.size;header=new Uint8Array(await blob.slice(0,65536).arrayBuffer());}
 else{if(!readable(uri))throw new UploadSelectionError('type');const file=new File(uri);size=file.size;const handle=file.open(FileMode.ReadOnly);try{header=await handle.readBytes(65536);}finally{handle.close();}}
 return {size,header,...imageDimensions(encode(header))};
}
