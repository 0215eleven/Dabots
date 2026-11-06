import type {MobileClient} from '@ds-bot/mobile-sdk';
import type {DsMessage} from './contracts.ts';
import type {PresentedAttachment} from '../../openbot/mobile/src/features/chat/model/attachment-presentation.ts';
import {parseDsId} from './identity.ts';
import {blobBytes} from '../logic/blob.ts';
import {imageHeader} from '../logic/image-header.ts';
import {encode,decode} from '@stablelib/base64';

export interface PreviewScope {serverId:string;epoch:string;conversationId:string;sessionId:string;seq:number;attachmentId:string}
const prefix='ds-preview-v1:',epochs=new WeakMap<object,string>(),launch=Date.now().toString(36);let next=0;
export function previewEpoch(owner:object){let epoch=epochs.get(owner);if(!epoch){epoch=`${launch}-${++next}`;epochs.set(owner,epoch);}return epoch;}
const problems={scope:'This preview belongs to a different connection. Reopen the chat.',auth:'Access to this image preview is no longer available. Reconnect and try again.',network:'The image preview could not be downloaded. Try again.',mime:'The computer returned an unsupported preview format.',size:'The image preview exceeds the safe download limit.',empty:'The computer returned an empty image preview.',encoding:'The image preview data is incomplete or damaged.',format:'The image preview content does not match its format.',dimensions:'The image preview exceeds the safe image dimensions.',busy:'Too many image previews are waiting. Try again.',unavailable:'This image preview is unavailable.'} as const;
const previewMessages={...problems,decode:'The image preview could not be opened on this device. Try again.'} as const;
export class PreviewError extends Error{code:string;constructor(reason:keyof typeof previewMessages){super(previewMessages[reason]);this.name='PreviewError';this.code='PREVIEW_'+reason.toUpperCase();}}
const unavailable=()=>new PreviewError('unavailable');
function problem(reason:keyof typeof problems):never{throw new PreviewError(reason);}
type PreviewClient=Pick<MobileClient,'attachment'>&Partial<Pick<MobileClient,'attachmentData'>>;
const mimeTypes=new Set(['image/png','image/jpeg','image/webp']);
const validString=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(v);
function validScope(v:PreviewScope){return validString(v.serverId)&&validString(v.epoch)&&validString(v.conversationId)&&validString(v.sessionId)&&Number.isSafeInteger(v.seq)&&v.seq>=0&&/^sha256:[a-f0-9]{64}$/.test(v.attachmentId);}
function encodeScope(v:PreviewScope){return prefix+encodeURIComponent(JSON.stringify([v.serverId,v.epoch,v.conversationId,v.sessionId,v.seq,v.attachmentId]));}
export function decodePreviewId(value:string):PreviewScope{
 if(typeof value!=='string'||value.length>4096||!value.startsWith(prefix))throw unavailable();
 let data:unknown;try{data=JSON.parse(decodeURIComponent(value.slice(prefix.length)));}catch{throw unavailable();}
 if(!Array.isArray(data)||data.length!==6)throw unavailable();
 const scope={serverId:data[0],epoch:data[1],conversationId:data[2],sessionId:data[3],seq:data[4],attachmentId:data[5]} as PreviewScope;
 if(!validScope(scope)||encodeScope(scope)!==value)throw unavailable();return scope;
}
export function messageAttachments(message:DsMessage,options:{previews?:boolean;epoch?:string}={}):PresentedAttachment[]{
 return (message.ds.attachments??[]).map((file,index)=>{
  const name=typeof file.name==='string'?file.name:'File',size=Number.isSafeInteger(file.size)&&Number(file.size)>0?Number(file.size):0;
  const fallback:PresentedAttachment={id:`ds-file:${message.id}:${index}`,name,size,kind:'file',mimeType:'application/octet-stream',previewKind:'none',previewUrl:null,downloadMode:'unavailable'};
  const image=file.type==='image'&&file.previewAvailable===true?file:file.preview as Record<string,unknown>|undefined;
  if(!options.previews||!options.epoch||!image||typeof image.id!=='string'||typeof image.mediaType!=='string'||!mimeTypes.has(image.mediaType)
   ||!Number.isSafeInteger(image.size)||Number(image.size)<=0||Number(image.size)>4194304||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)
   ||Number(image.width)<=0||Number(image.height)<=0||Math.max(Number(image.width),Number(image.height))>2048||Number(image.width)*Number(image.height)>4194304)return fallback;
  try{
   const owner=parseDsId(message.ds.conversationId),source=message.ds.source;
   const scope={serverId:owner.serverId,epoch:options.epoch,conversationId:owner.sourceId,sessionId:source.sessionId,seq:source.seq,attachmentId:image.id};
   if(owner.kind!=='conversation'||!validScope(scope))return fallback;
   return {...fallback,id:encodeScope(scope),size:Number(image.size),kind:'image',mimeType:image.mediaType,previewKind:'image',downloadMode:'preview',
    ...(file.type==='file'?{originalFile:{name,size}}:{})};
  }catch{return fallback;}
 });
}
type PreviewReadOptions={signal?:AbortSignal;current:(scope:PreviewScope)=>boolean};
type PreviewWaiter={start:()=>void;cancel:()=>void};
const reads=new WeakMap<object,{active:number;waiting:PreviewWaiter[]}>();
// Several cards can mount together. Queue small preview reads instead of causing
// the host's two-per-device resource guard to reject ordinary multi-photo messages.
export async function readPreview(client:PreviewClient,serverId:string,epoch:string,id:string,options:PreviewReadOptions){
 options.signal?.throwIfAborted();
 let queue=reads.get(client);if(!queue){queue={active:0,waiting:[]};reads.set(client,queue);}
 const state=queue;if(state.waiting.length>=32)problem('busy');
 await new Promise<void>((resolve,reject)=>{
  const waiter:PreviewWaiter={start:()=>{options.signal?.removeEventListener('abort',waiter.cancel);state.active++;resolve();},cancel:()=>{const index=state.waiting.indexOf(waiter);if(index>=0)state.waiting.splice(index,1);reject(options.signal?.reason??unavailable());}};
  if(state.active<2)waiter.start();else{state.waiting.push(waiter);options.signal?.addEventListener('abort',waiter.cancel,{once:true});}
 });
 try{return await readScopedPreview(client,serverId,epoch,id,options);}
 finally{state.active--;state.waiting.shift()?.start();if(!state.active&&!state.waiting.length)reads.delete(client);}
}
async function readScopedPreview(client:PreviewClient,serverId:string,epoch:string,id:string,options:PreviewReadOptions){
 const scope=decodePreviewId(id),check=()=>{options.signal?.throwIfAborted();if(scope.serverId!==serverId||scope.epoch!==epoch)problem('scope');if(!options.current(scope))problem('auth');};check();
 let bytes:Uint8Array,mime:string;
 try{
  if(typeof client.attachmentData==='function'){
   const data=await client.attachmentData(scope.conversationId,scope.sessionId,scope.attachmentId,{seq:scope.seq,signal:options.signal});check();
   if(!data||typeof data.base64!=='string')problem('encoding');if(data.base64.length>1398104)problem('size');
   mime=String(data.mimeType).split(';')[0].trim().toLowerCase();if(!mimeTypes.has(mime))problem('mime');
   try{bytes=decode(data.base64);if(encode(bytes)!==data.base64)problem('encoding');}catch{problem('encoding');}
  }else{
   const blob=await client.attachment(scope.conversationId,scope.sessionId,scope.attachmentId,{seq:scope.seq,signal:options.signal});check();
   if(!blob||!Number.isSafeInteger(blob.size)||blob.size>1048576)problem('size');if(blob.size<=0)problem('empty');
   mime=String(blob.type).split(';')[0].trim().toLowerCase();if(!mimeTypes.has(mime))problem('mime');
   bytes=new Uint8Array(await blobBytes(blob));check();if(bytes.length!==blob.size)problem('encoding');
  }
 }catch(error){
  options.signal?.throwIfAborted();if(error instanceof PreviewError)throw error;
  const code=error&&typeof error==='object'&&'code'in error?String(error.code):'',status=error&&typeof error==='object'&&'status'in error?Number(error.status):0;
  if(status===401||status===403||['stale_connection','session_changed','disposed'].includes(code))problem('auth');
  if(status===404||code==='UNSUPPORTED')problem('unavailable');
  const mapped={preview_size:'size',preview_empty:'empty',preview_mime:'mime',preview_encoding:'encoding',preview_truncated:'encoding',preview_read:'encoding'} as const;
  if(Object.hasOwn(mapped,code))problem(mapped[code as keyof typeof mapped]);problem('network');
 }
 check();if(!bytes.length)problem('empty');if(bytes.length>1048576)problem('size');
 const shape=imageHeader(bytes);if(!shape)problem('encoding');if(shape.mimeType!==mime)problem('format');if(Math.max(shape.width,shape.height)>1536)problem('dimensions');check();
 return {name:'preview.'+(mime==='image/jpeg'?'jpg':mime.split('/')[1]),mimeType:mime,base64:encode(bytes),dimensions:{width:shape.width,height:shape.height}};
}
