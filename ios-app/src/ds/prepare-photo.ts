import {File,Paths} from 'expo-file-system';
import {Platform} from 'react-native';
import {preparePhoto,type PhotoSelection} from '../logic/prepare-photo';
import {copyDraftUpload,discardDraftUpload,inspectPhotoFile} from './attachment-files';
import type {LocalUpload} from './upload-types';

export function discardConvertedPhoto(uri:string){
 try{
  if(Platform.OS==='web'){if(uri.startsWith('blob:'))URL.revokeObjectURL(uri);return;}
  if(uri.startsWith(Paths.cache.uri+'ImageManipulator/')&&!decodeURIComponent(uri).includes('..'))new File(uri).delete();
 }catch{}
}
export async function prepareSelectedPhoto(asset:PhotoSelection,maxBytes:number,signal?:AbortSignal){
 // The picker URI's extension describes its actual exported representation. Original names can be stale.
 const guessed=asset.fileName??`photo.${asset.uri.split('.').at(-1)?.split('?')[0]??'jpg'}`;
 const copy=await copyDraftUpload(asset.uri,guessed,maxBytes,signal,'photo');
 let localFile:LocalUpload=copy;
 try{
 const prepared=await preparePhoto({...asset,uri:copy.uri},maxBytes,{
  inspect:uri=>inspectPhotoFile(uri,signal),
  async encode(uri,{format,maxEdge,quality}){
   // Keep decoding within pixel bounds; never create a full-resolution base64 copy first.
   const {ImageManipulator,SaveFormat}=await import('expo-image-manipulator');
   const context=ImageManipulator.manipulate(uri,{maxWidth:maxEdge,maxHeight:maxEdge});
   try{
    const image=await context.renderAsync();
    try{return (await image.saveAsync({format:format==='png'?SaveFormat.PNG:SaveFormat.JPEG,compress:quality})).uri;}
    finally{image.release();}
   }finally{context.release();}
  },
  discard:discardConvertedPhoto,
  signal,
 });
 localFile={...copy,name:prepared.name,mediaType:prepared.mimeType,kind:'photo',preview:prepared.preview,previewUnavailable:prepared.previewUnavailable};
 signal?.throwIfAborted();
 return {uri:copy.uri,name:prepared.name,localFile,discard:()=>discardDraftUpload(localFile)};
 }catch(error){discardDraftUpload(localFile);throw error;}
}
