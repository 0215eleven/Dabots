import type {Attachment,MobileClient} from '@ds-bot/mobile-sdk';
import {decode} from '@stablelib/base64';
export const MOBILE_UPLOAD_LIMITS={maxBytes:2097152,maxFiles:4,maxTotalBytes:4194304};
const images:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
const documents=new Set(['txt','md','markdown','csv','json','jsonl','log','yaml','yml','xml','pdf','doc','docx','xls','xlsx','ppt','pptx']);
export type SelectedUpload={id:string;name:string;mimeType:string;base64:string;size:number};
export function validateSelectedUploads(items:readonly SelectedUpload[]){
 if(items.length>4||items.reduce((total,item)=>total+item.size,0)>4194304)throw Error('Choose up to 4 attachments, at most 4 MiB in total.');
 for(const item of items){const extension=item.name.split('.').at(-1)?.toLowerCase()??'';if(!item.name.trim()||item.name.length>255||/[\p{Cc}\p{Zl}\p{Zp}/\\:]/u.test(item.name)||(!images[extension]&&!documents.has(extension))||(images[extension]&&images[extension]!==item.mimeType))throw Error('Choose PNG/JPEG/WebP or a supported text, PDF or Office document.');if(item.size<=0||item.size>2097152)throw Error('Each attachment must contain 1 byte to 2 MiB.');}
}
export async function uploadAttachments(client:Pick<MobileClient,'upload'|'target'|'removeUpload'>,conversationId:string,items:readonly SelectedUpload[],signal?:AbortSignal):Promise<Attachment[]>{
 validateSelectedUploads(items);if(!items.length)return[];
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
