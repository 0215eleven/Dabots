import type {MobileClient} from '@ds-bot/mobile-sdk';
import type {DsMessage} from './contracts.ts';
import type {PresentedAttachment} from '../../openbot/mobile/src/features/chat/model/attachment-presentation.ts';
import {parseDsId} from './identity.ts';
import {blobBytes} from '../logic/blob.ts';
import {imageDimensions} from '../../openbot/mobile/src/features/chat/model/image-dimensions.ts';
import {encode} from '@stablelib/base64';

export interface PreviewScope {serverId:string;epoch:string;conversationId:string;sessionId:string;seq:number;attachmentId:string}
const prefix='ds-preview-v1:',epochs=new WeakMap<object,string>(),launch=Date.now().toString(36);let next=0;
export function previewEpoch(owner:object){let epoch=epochs.get(owner);if(!epoch){epoch=`${launch}-${++next}`;epochs.set(owner,epoch);}return epoch;}
const unavailable=()=>new Error('This image preview is unavailable.');
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
export async function readPreview(client:Pick<MobileClient,'attachment'>,serverId:string,epoch:string,id:string,options:PreviewReadOptions){
 options.signal?.throwIfAborted();
 let queue=reads.get(client);if(!queue){queue={active:0,waiting:[]};reads.set(client,queue);}
 const state=queue;if(state.waiting.length>=32)throw unavailable();
 await new Promise<void>((resolve,reject)=>{
  const waiter:PreviewWaiter={start:()=>{options.signal?.removeEventListener('abort',waiter.cancel);state.active++;resolve();},cancel:()=>{const index=state.waiting.indexOf(waiter);if(index>=0)state.waiting.splice(index,1);reject(options.signal?.reason??unavailable());}};
  if(state.active<2)waiter.start();else{state.waiting.push(waiter);options.signal?.addEventListener('abort',waiter.cancel,{once:true});}
 });
 try{return await readScopedPreview(client,serverId,epoch,id,options);}
 finally{state.active--;state.waiting.shift()?.start();if(!state.active&&!state.waiting.length)reads.delete(client);}
}
async function readScopedPreview(client:Pick<MobileClient,'attachment'>,serverId:string,epoch:string,id:string,options:PreviewReadOptions){
 const scope=decodePreviewId(id),check=()=>{options.signal?.throwIfAborted();if(scope.serverId!==serverId||scope.epoch!==epoch||!options.current(scope))throw unavailable();};check();
 const blob=await client.attachment(scope.conversationId,scope.sessionId,scope.attachmentId,{seq:scope.seq,signal:options.signal});check();
 if(!blob||!Number.isSafeInteger(blob.size)||blob.size<=0||blob.size>1048576||!mimeTypes.has(blob.type))throw unavailable();
 const bytes=new Uint8Array(await blobBytes(blob));check();if(bytes.length!==blob.size)throw unavailable();
 const base64=encode(bytes),shape=imageDimensions(base64);if(!shape||Math.max(shape.width,shape.height)>1536)throw unavailable();
 const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpeg=bytes[0]===255&&bytes[1]===216,webp=String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
 if(blob.type==='image/png'?!png:blob.type==='image/jpeg'?!jpeg:!webp)throw unavailable();check();
 return {name:'preview.'+(blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1]),mimeType:blob.type,base64};
}
