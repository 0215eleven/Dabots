// Independently implemented bounded native/HTTP preview payload adapter.
export const PREVIEW_BYTES=1048576;
export class AttachmentPayloadError extends Error{constructor(code){super('The image preview response could not be read safely.');this.name='AttachmentPayloadError';this.code=code;}}
const fail=code=>{throw new AttachmentPayloadError(code)};
export function previewMime(value){const mime=String(value??'').split(';')[0].trim().toLowerCase();if(!['image/png','image/jpeg','image/webp'].includes(mime))fail('preview_mime');return mime;}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function previewBase64(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>PREVIEW_BYTES)fail('preview_size');if(!bytes.length)fail('preview_empty');
 const blocks=[];for(let offset=0;offset<bytes.length;){let block='';const end=Math.min(bytes.length,offset+12288);for(;offset<end;offset+=3){const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2];block+=alphabet[a>>>2]+alphabet[((a&3)<<4)|((b??0)>>>4)]+(b===undefined?'=':alphabet[((b&15)<<2)|((c??0)>>>6)])+(c===undefined?'=':alphabet[c&63]);}blocks.push(block);}return blocks.join('');
}
function checkedPayload(value,mime){
 if(!value||typeof value.base64!=='string'||value.base64.length>Math.ceil(PREVIEW_BYTES/3)*4)fail('preview_size');
 const text=value.base64;if(!text.length)fail('preview_empty');if(text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))fail('preview_encoding');
 const size=text.length/4*3-(text.endsWith('==')?2:text.endsWith('=')?1:0);if(size>PREVIEW_BYTES)fail('preview_size');
 if(previewMime(value.mimeType)!==mime)fail('preview_mime');return {name:'preview.'+(mime==='image/jpeg'?'jpg':mime.split('/')[1]),mimeType:mime,base64:text};
}
/** Plain values cross the native boundary; image originals never use this reader. */
export async function readAttachmentData(response,signal){
 signal?.throwIfAborted();const headers=new Headers(response.headers),mime=previewMime(headers.get('content-type')),length=headers.get('content-length');
 const declared=length===null?null:Number(length);if(declared!==null&&(!Number.isSafeInteger(declared)||declared<0||declared>PREVIEW_BYTES))fail('preview_size');
 let value;
 if(typeof response.attachmentData==='function'){
  try{value=await response.attachmentData({maximum:PREVIEW_BYTES,signal});}
  catch(error){signal?.throwIfAborted();if(error instanceof AttachmentPayloadError)throw error;fail(['preview_size','preview_empty','preview_encoding','preview_mime'].includes(error?.code)?error.code:'preview_read');}
 }
 else{
  let bytes;
  if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){signal?.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>PREVIEW_BYTES)fail('preview_size');chunks.push(part.value);}bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
  else if(typeof response.arrayBuffer==='function')bytes=new Uint8Array(await response.arrayBuffer());
  else{
   const blob=await response.blob();if(blob.size>PREVIEW_BYTES)fail('preview_size');
   if(typeof blob.arrayBuffer==='function')bytes=new Uint8Array(await blob.arrayBuffer());
   else{value=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new AttachmentPayloadError('preview_read'));reader.onabort=()=>reject(new AttachmentPayloadError('preview_read'));reader.onload=()=>{const result=String(reader.result??''),comma=result.indexOf(',');if(comma<0)reject(new AttachmentPayloadError('preview_encoding'));else resolve({mimeType:mime,base64:result.slice(comma+1)});};reader.readAsDataURL(blob);});}
  }
  if(bytes)value={mimeType:mime,base64:previewBase64(bytes)};
 }
 signal?.throwIfAborted();const result=checkedPayload(value,mime),actual=result.base64.length/4*3-(result.base64.endsWith('==')?2:result.base64.endsWith('=')?1:0);
 if(declared!==null&&!headers.get('content-encoding')&&declared!==actual)fail('preview_truncated');return result;
}
