import { randomUUID, createHash } from 'node:crypto'
import { mkdir, open, readdir, stat, truncate, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { BridgeError } from './auth.js'

export const TRANSFER_LIMITS = Object.freeze({maxBytes:100000000,maxTotalBytes:100000000,maxFiles:4,chunkBytes:262144,deviceBytes:200000000,globalBytes:1000000000,idleMs:900000,expiresMs:86400000,previewBytes:2097152})
const images={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',heic:'image/heic',heif:'image/heif',gif:'image/gif',avif:'image/avif'}
const documents=new Set(['txt','md','markdown','csv','json','jsonl','log','yaml','yml','xml','pdf','doc','docx','xls','xlsx','ppt','pptx'])
const owned=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
const fail=(code,message,status=400)=>{throw new BridgeError(status,code,message)}
const unavailable=()=>fail('UPLOAD_EXPIRED','Select and upload this attachment again for the receiving conversation.',409)
function metadata(input){
 if(!input||Object.keys(input).some(key=>!['clientId','name','mediaType','size','kind','previewFor'].includes(key)))fail('INVALID_UPLOAD','Invalid upload metadata.')
 const {clientId,name,mediaType,size,kind='file',previewFor}=input
 if(typeof clientId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(clientId)||typeof name!=='string'||!name.trim()||name.length>255||/[\p{Cc}\p{Zl}\p{Zp}/\\:]/u.test(name)||name==='.'||name==='..')fail('INVALID_FILENAME','Use a plain filename and a valid upload identifier.')
 const extension=name.split('.').at(-1).toLowerCase()
 if(!['file','photo','preview'].includes(kind)||typeof mediaType!=='string'||mediaType.length>128)fail('UNSUPPORTED_FILE','Unsupported attachment.',415)
 if(kind==='file'?!documents.has(extension):images[extension]!==mediaType)fail('UNSUPPORTED_FILE','The selected file type does not match its name.',415)
 if(kind==='preview'&&!['image/png','image/jpeg','image/webp'].includes(mediaType))fail('UNSUPPORTED_FILE','Unsupported model preview.',415)
 if(!Number.isSafeInteger(size)||size<=0||size>(kind==='preview'?TRANSFER_LIMITS.previewBytes:TRANSFER_LIMITS.maxBytes))fail('FILE_TOO_LARGE','The attachment exceeds its negotiated byte limit.',413)
 if(kind==='preview'?!owned(previewFor):previewFor!==undefined)fail('INVALID_UPLOAD','A model preview must identify its original photo.')
 return {clientId,name,mediaType,size,kind,...(previewFor?{previewFor}:{})}
}

/** Private bounded staging, owned by a phone and an immutable receiving Session. */
export async function createUploadTransfers({home,auth,now=Date.now}){
 const directory=join(home,'upload-transfers');await mkdir(directory,{recursive:true,mode:0o700})
 const entries=auth.data.transfers??={};let queue=Promise.resolve()
 const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next}
 const path=id=>join(directory,id)
 async function drop(id){if(!owned(id))return;await unlink(path(id)).catch(error=>{if(error.code!=='ENOENT')throw error});delete entries[id]}
 function get(id,scope){const entry=owned(id)?entries[id]:undefined;if(!entry||entry.expiresAt<=now()||entry.deviceId!==scope.deviceId||['conversationId','sessionId'].some(key=>scope[key]!==undefined&&entry[key]!==scope[key]))unavailable();return entry}
 function view(entry){return {id:entry.id,receiptId:entry.state==='complete'?entry.id:undefined,clientId:entry.clientId,conversationId:entry.conversationId,sessionId:entry.sessionId,state:entry.state,offset:entry.offset,name:entry.name,size:entry.size,mediaType:entry.mediaType,kind:entry.kind,type:'file',expiresAt:entry.expiresAt,...(entry.previewFor?{previewFor:entry.previewFor}:{}),...(entry.sha256?{sha256:entry.sha256}:{})}}
 async function prune(){return serial(async()=>{
  for(const [id,entry] of Object.entries(entries)){
   if(!owned(id)||entry.expiresAt<=now()){await drop(id);continue}
   try{const size=(await stat(path(id))).size;if(size<entry.offset||entry.offset>entry.size)await drop(id);else if(size>entry.offset)await truncate(path(id),entry.offset)}catch(error){if(error.code==='ENOENT')delete entries[id];else throw error}
  }
  for(const id of await readdir(directory))if(owned(id)&&!entries[id])await unlink(path(id))
  await auth.save()
 })}
 await prune();const timer=setInterval(()=>{void prune().catch(()=>{})},60000);timer.unref?.()
 async function* stream(entry,signal){
  const hash=createHash('sha256');let size=0
  for await(const chunk of createReadStream(path(entry.id),{highWaterMark:65536,...(signal?{signal}:{})})){signal?.throwIfAborted();size+=chunk.length;hash.update(chunk);yield chunk}
  if(size!==entry.size||hash.digest('hex')!==entry.sha256)fail('UPLOAD_CORRUPT','The staged file changed. Upload it again.',409)
 }
 return {
  prune,close:async()=>{clearInterval(timer);await queue},
  begin:(scope,input)=>serial(async()=>{
   const checked=metadata(input)
   if(!scope?.deviceId||!scope.conversationId||!scope.sessionId)unavailable()
   const all=Object.values(entries).filter(entry=>entry.expiresAt>now()),prior=all.find(entry=>entry.deviceId===scope.deviceId&&entry.clientId===checked.clientId)
   if(prior){if(['conversationId','sessionId'].some(key=>prior[key]!==scope[key])||Object.keys(checked).some(key=>prior[key]!==checked[key]))fail('UPLOAD_CONFLICT','This upload identifier already names different content.',409);return view(prior)}
   if(checked.previewFor){const original=get(checked.previewFor,scope);if(original.kind!=='photo'||original.state!=='complete')unavailable();if(original.bound)fail('UPLOAD_BOUND','This original is already bound for submission.',409);if(all.some(entry=>entry.previewFor===original.id))fail('UPLOAD_CONFLICT','This original already has a model preview.',409)}
   const device=all.filter(entry=>entry.deviceId===scope.deviceId),receiving=all.filter(entry=>entry.state==='receiving')
   if(receiving.length>=4||receiving.some(entry=>entry.deviceId===scope.deviceId))fail('UPLOAD_BUSY','Wait for current uploads to finish.',429)
   if(all.length>=64||device.length>=16||all.reduce((sum,entry)=>sum+entry.size,0)+checked.size>TRANSFER_LIMITS.globalBytes||device.reduce((sum,entry)=>sum+entry.size,0)+checked.size>TRANSFER_LIMITS.deviceBytes)fail('UPLOAD_QUOTA','Remove unused attachments or wait for them to expire.',429)
   const id=randomUUID(),entry={...checked,...scope,id,state:'receiving',offset:0,expiresAt:now()+TRANSFER_LIMITS.idleMs}
   const file=await open(path(id),'wx',0o600);await file.close();entries[id]=entry
   try{await auth.save()}catch(error){await drop(id);throw error}return view(entry)
  }),
  status:(id,scope)=>serial(async()=>view(get(id,scope))),
  write:(id,scope,offset,bytes)=>serial(async()=>{
   const entry=get(id,scope)
   if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>TRANSFER_LIMITS.chunkBytes||!Number.isSafeInteger(offset)||offset<0||offset+bytes.length>entry.size)fail('INVALID_CHUNK','Send a bounded chunk within the declared file size.',413)
   const handle=await open(path(id),'r+')
   try{
    if(offset<entry.offset){
     if(offset+bytes.length>entry.offset)fail('OFFSET_CONFLICT','Resume at the acknowledged offset.',409)
     const existing=Buffer.alloc(bytes.length),read=await handle.read(existing,0,bytes.length,offset)
     if(read.bytesRead!==bytes.length||!existing.equals(bytes))fail('CHUNK_CONFLICT','Previously acknowledged bytes differ.',409)
     return view(entry)
    }
    if(entry.state!=='receiving'||offset!==entry.offset)fail('OFFSET_CONFLICT','Resume at the acknowledged offset.',409)
    let written=0;while(written<bytes.length){const next=await handle.write(bytes,written,bytes.length-written,offset+written);if(!next.bytesWritten)throw Error('Unable to write upload chunk');written+=next.bytesWritten}
    await handle.sync();entry.offset+=bytes.length;entry.expiresAt=now()+TRANSFER_LIMITS.idleMs;await auth.save();return view(entry)
   }finally{await handle.close()}
  }),
  complete:(id,scope,expected)=>serial(async()=>{
   const entry=get(id,scope)
   if(typeof expected!=='string'||!/^[0-9a-f]{64}$/.test(expected))fail('INVALID_DIGEST','Send the complete SHA-256 digest.')
   if(entry.state==='complete'){if(entry.sha256!==expected)fail('DIGEST_MISMATCH','The original bytes do not match.',409);return view(entry)}
   if(entry.offset!==entry.size)fail('UPLOAD_INCOMPLETE','Upload all bytes before completing.',409)
   const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(path(id),{highWaterMark:65536})){size+=chunk.length;hash.update(chunk)}
   if(size!==entry.size||hash.digest('hex')!==expected)fail('DIGEST_MISMATCH','The original bytes do not match.',409)
   entry.state='complete';entry.sha256=expected;entry.expiresAt=now()+TRANSFER_LIMITS.expiresMs;await auth.save();return view(entry)
  }),
  resolve:(ids,scope)=>serial(async()=>{
   if(!Array.isArray(ids)||ids.length>TRANSFER_LIMITS.maxFiles||new Set(ids).size!==ids.length)fail('INVALID_ATTACHMENTS','Choose at most four originals.')
   let total=0;const result=[]
   for(const id of ids){const entry=get(id,scope);if(entry.state!=='complete'||entry.kind==='preview')unavailable();total+=entry.size
    if(total>TRANSFER_LIMITS.maxTotalBytes)fail('FILE_TOO_LARGE','Keep original message attachments within 100 MB.',413)
    result.push({...view(entry),type:'stream-file',stream:signal=>stream(entry,signal)})
    if(Object.values(entries).some(candidate=>candidate.previewFor===id&&candidate.state!=='complete'&&candidate.expiresAt>now()))fail('UPLOAD_INCOMPLETE','Finish or remove the model preview before submitting.',409)
    const preview=Object.values(entries).find(candidate=>candidate.previewFor===id&&candidate.state==='complete'&&candidate.expiresAt>now())
    if(preview){get(preview.id,scope);result.push({...view(preview),type:'stream-preview',stream:signal=>stream(preview,signal)})}
   }
   for(const id of ids)entries[id].bound=true
   await auth.save();return result
  }),
  remove:(id,scope)=>serial(async()=>{get(id,scope);for(const [key,entry] of Object.entries(entries))if(key===id||entry.previewFor===id)await drop(key);await auth.save()}),
  removeDevice:(deviceId,conversationKind)=>serial(async()=>{for(const [id,entry] of Object.entries(entries))if(entry.deviceId===deviceId&&(!conversationKind||entry.conversationKind===conversationKind))await drop(id);await auth.save()}),
 }
}
