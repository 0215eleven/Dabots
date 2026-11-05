import type {Attachment,MobileClient} from '@ds-bot/mobile-sdk';
import {decode} from '@stablelib/base64';
import type {LocalUpload} from '../ds/upload-types';
export const MOBILE_UPLOAD_LIMITS={maxBytes:100000000,maxFiles:4,maxTotalBytes:100000000};
export const LEGACY_UPLOAD_LIMITS={maxBytes:2097152,maxFiles:4,maxTotalBytes:4194304};
export class UploadSelectionError extends Error {
 readonly reason:'count'|'total'|'name'|'type'|'size'|'damaged'|'quota';readonly fileName:string;
 constructor(reason:UploadSelectionError['reason'],fileName=''){
  super(reason==='count'||reason==='total'?'Choose up to 4 attachments, at most 100 MB in total.':reason==='size'?'Each original attachment must contain 1 byte to 100 MB.':reason==='damaged'?'The attachment is damaged. Select it again.':'Choose a supported photo, text, PDF or Office document.');
  this.reason=reason;this.fileName=fileName;
 }
}
const images:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
const documents=new Set(['txt','md','markdown','csv','json','jsonl','log','yaml','yml','xml','pdf','doc','docx','xls','xlsx','ppt','pptx']);
const originalImages:Record<string,string>={...images,heic:'image/heic',heif:'image/heif',gif:'image/gif',avif:'image/avif'};
export const uploadKind=(name:string)=>originalImages[name.split('.').at(-1)?.toLowerCase()??'']?'photo':documents.has(name.split('.').at(-1)?.toLowerCase()??'')?'file':null;
export type SelectedUpload={id:string;name:string;mimeType:string;base64:string;size:number;localFile?:LocalUpload};
export function validateSelectedUploads(items:readonly SelectedUpload[],limits=MOBILE_UPLOAD_LIMITS){
 if(items.length>limits.maxFiles)throw new UploadSelectionError('count');
 if(items.reduce((total,item)=>total+item.size,0)>limits.maxTotalBytes)throw new UploadSelectionError('total');
 for(const item of items){
  const extension=item.name.split('.').at(-1)?.toLowerCase()??'';
  if(!item.name.trim()||item.name.length>255||/[\p{Cc}\p{Zl}\p{Zp}/\\:]/u.test(item.name))throw new UploadSelectionError('name',item.name);
  const allowed=item.localFile?.kind==='photo'?originalImages:images,mediaType=item.localFile?.mediaType??item.mimeType;
  if((!allowed[extension]&&!documents.has(extension))||(allowed[extension]&&allowed[extension]!==mediaType))throw new UploadSelectionError('type',item.name);
  if(!Number.isSafeInteger(item.size)||item.size<=0)throw new UploadSelectionError('damaged',item.name);
  if(item.size>limits.maxBytes)throw new UploadSelectionError('size',item.name);
 }
}
export async function uploadAttachments(client:Pick<MobileClient,'upload'|'target'|'removeUpload'>,conversationId:string,items:readonly SelectedUpload[],signal?:AbortSignal):Promise<Attachment[]>{
 validateSelectedUploads(items,LEGACY_UPLOAD_LIMITS);if(!items.length)return[];
 const {sessionId}=await client.target(conversationId),uploaded:Attachment[]=[];
 try {
  for (const item of items) {
   signal?.throwIfAborted();
   const bytes=decode(item.base64);
   if(bytes.length!==item.size)throw Error('The selected file changed. Select it again.');
   const receipt=await client.upload({conversationId,sessionId,name:item.name,mediaType:item.mimeType,body:new Uint8Array(bytes).buffer,signal});
   if (receipt.receiptId) uploaded.push(receipt);
   if(!receipt.receiptId||receipt.name!==item.name||receipt.size!==item.size)throw Error('The computer did not confirm this attachment.');
  }
  signal?.throwIfAborted();
  return uploaded;
 }
 catch(error){await Promise.allSettled(uploaded.map(item=>client.removeUpload(item.receiptId!)));throw error;}
}
export async function uploadStreamedAttachments(client:Pick<MobileClient,'uploadFile'|'target'|'removeTransfer'>,conversationId:string,items:readonly SelectedUpload[],
 options:{signal?:AbortSignal;read:(uri:string,size:number,offset:number,length:number)=>Promise<Uint8Array>;onTransfer?:(sourceId:string,id:string)=>void;onProgress?:(bytes:number,total:number,phase:'original'|'preview')=>void}):Promise<Attachment[]>{
 validateSelectedUploads(items);if(!items.length)return[];
 const {sessionId}=await client.target(conversationId),total=items.reduce((sum,item)=>sum+item.size,0),uploaded:Attachment[]=[];let done=0;
 for(const item of items){
  options.signal?.throwIfAborted();const source=item.localFile,sourceId=source?.clientId??item.id;
  // Pasted text has a small in-memory representation; picked files always use owned URI chunks.
  const inline=source?undefined:decode(item.base64);
  const receipt=await client.uploadFile({conversationId,sessionId,clientId:sourceId,name:item.name,mediaType:source?.mediaType??item.mimeType,size:item.size,kind:source?.kind??'file',expectedSha256:source?.sha256,signal:options.signal,
   read:source?(offset,length)=>options.read(source.uri,source.size,offset,length):async(offset,length)=>inline!.subarray(offset,offset+length),
   onTransfer:id=>options.onTransfer?.(sourceId,id),onProgress:bytes=>options.onProgress?.(done+bytes,total,'original')});
  uploaded.push(receipt);
  if(source?.preview){const preview=source.preview;
   options.onProgress?.(done+item.size,total,'preview');
   await client.uploadFile({conversationId,sessionId,clientId:sourceId+'_preview',name:preview.name,mediaType:preview.mimeType,size:preview.size,kind:'preview',previewFor:receipt.receiptId,signal:options.signal,
    read:(offset,length)=>options.read(preview.uri,preview.size,offset,length),onTransfer:id=>options.onTransfer?.(sourceId,id)});
  }
  done+=item.size;
 }
 return uploaded;
}
