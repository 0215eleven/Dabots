import {randomUUID} from 'node:crypto'
import {mkdir,readFile,writeFile,unlink,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {BridgeError} from './auth.js'
export const UPLOAD_LIMITS=Object.freeze({maxBytes:2*1024*1024,maxTotalBytes:4*1024*1024,maxFiles:4,expiresMs:24*60*60*1000})
const images={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}
const documents=new Set(['txt','md','markdown','csv','json','jsonl','log','yaml','yml','xml','pdf','doc','docx','xls','xlsx','ppt','pptx'])
const fail=(code,message,status=400)=>{throw new BridgeError(status,code,message)}
export function validateUpload(name,mediaType,size){
 if(typeof name!=='string'||!name.trim()||name.length>255||/[\p{Cc}\p{Zl}\p{Zp}/\\:]/u.test(name)||name==='.'||name==='..')fail('INVALID_FILENAME','Use a plain filename without path separators.')
 const extension=name.split('.').at(-1).toLowerCase(),image=images[extension]
 if(!image&&!documents.has(extension))fail('UNSUPPORTED_FILE','Choose PNG/JPEG/WebP or a supported text, PDF or Office document.',415)
 if(image&&mediaType!==image)fail('UNSUPPORTED_FILE','The image type does not match its filename.',415)
 if(!Number.isSafeInteger(size)||size<=0||size>UPLOAD_LIMITS.maxBytes)fail('FILE_TOO_LARGE','Each attachment must contain 1 byte to 2 MiB.',413)
 return {name,mediaType:image??'application/octet-stream',type:image?'image':'file-upload'}
}
export async function createUploads(home,auth){
 const directory=join(home,'uploads');await mkdir(directory,{recursive:true,mode:0o700});let queue=Promise.resolve()
 const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next}
 const owned=id=>/^[0-9a-f-]{36}$/.test(id)
 const remove=async id=>{if(!owned(id))return;await unlink(join(directory,id)).catch(error=>{if(error.code!=='ENOENT')throw error});delete auth.data.uploads[id]}
 async function prune(){return serial(async()=>{for(const [id,item] of Object.entries(auth.data.uploads))if(item.expiresAt<=Date.now())await remove(id);for(const id of await readdir(directory))if(owned(id)&&!auth.data.uploads[id])await unlink(join(directory,id));await auth.save()})}
 await prune();const timer=setInterval(()=>{void prune().catch(()=>{})},60000);timer.unref?.()
 return {
  prune,close:()=>{clearInterval(timer);return queue},
  put:input=>serial(async()=>{
   const checked=validateUpload(input.name,input.mediaType,input.bytes.length),all=Object.values(auth.data.uploads)
   if(all.length>=64||all.filter(item=>item.deviceId===input.deviceId).length>=16)fail('UPLOAD_QUOTA','Remove unused attachments or try again after they expire.',429)
   const receiptId=randomUUID(),item={...checked,deviceId:input.deviceId,conversationId:input.conversationId,sessionId:input.sessionId,size:input.bytes.length,expiresAt:Date.now()+UPLOAD_LIMITS.expiresMs}
   await writeFile(join(directory,receiptId),input.bytes,{flag:'wx',mode:0o600});auth.data.uploads[receiptId]=item
   try{await auth.save()}catch(error){await remove(receiptId);throw error}
   return{receiptId,name:item.name,type:item.type==='image'?'image':'file',mediaType:item.mediaType,size:item.size,expiresAt:item.expiresAt}
  }),
  async resolve(ids,scope){
   if(ids.length>UPLOAD_LIMITS.maxFiles||new Set(ids).size!==ids.length)fail('INVALID_ATTACHMENTS','Choose at most four distinct attachments.')
   let total=0;const parts=[]
   for(const id of ids){const item=auth.data.uploads[id];if(!owned(id)||!item||['deviceId','conversationId','sessionId'].some(key=>item[key]!==scope[key])||item.expiresAt<=Date.now())fail('UPLOAD_EXPIRED','Select and upload this attachment again for this conversation.',409)
    total+=item.size;if(total>UPLOAD_LIMITS.maxTotalBytes)fail('FILE_TOO_LARGE','Keep message attachments within 4 MiB.',413)
    const bytes=await readFile(join(directory,id));if(bytes.length!==item.size)fail('UPLOAD_EXPIRED','This attachment is unavailable. Select it again.',409)
    parts.push({type:item.type,name:item.name,mediaType:item.mediaType,data:bytes.toString('base64')})
   }return parts
  },
  remove:(id,deviceId)=>serial(async()=>{const item=auth.data.uploads[id];if(!item||item.deviceId!==deviceId)fail('UPLOAD_EXPIRED','This attachment is unavailable.',404);await remove(id);await auth.save()})
 }
}
