import {sha256} from '@noble/hashes/sha2.js';
const hex=value=>Array.from(value,x=>x.toString(16).padStart(2,'0')).join('');
const fail=message=>{throw Object.assign(new Error(message),{code:'upload_protocol'});};
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
function pause(ms,signal){return new Promise((resolve,reject)=>{signal?.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});}
function checkOffset(value,size){if(!Number.isSafeInteger(value)||value<0||value>size)fail('The computer returned an invalid upload offset.');return value;}

/** Sequential acknowledged chunks: the file source and transport never need a complete file buffer. */
export async function uploadFile(request,options,limits){
 const {conversationId,sessionId,clientId,name,mediaType,size,read,signal,onProgress,onTransfer,expectedSha256,kind='file',previewFor}=options;
 if(!limits||!Number.isSafeInteger(limits.chunkBytes)||limits.chunkBytes<1||limits.chunkBytes>262144||!Number.isSafeInteger(limits.maxBytes)||limits.maxBytes>100000000)fail('Update the phone, desktop plugin and relay for large attachments.');
 const maximum=kind==='preview'?Math.min(limits.previewBytes??0,2097152):limits.maxBytes;
 if(!Number.isSafeInteger(size)||size<=0||size>maximum||typeof read!=='function')fail('The attachment exceeds its negotiated byte limit.');
 signal?.throwIfAborted();let transfer;
 try{
  transfer=await request('/upload-transfers',{method:'POST',json:{conversationId,sessionId,clientId,name,mediaType,size,kind,...(previewFor?{previewFor}:{})},signal});
  if(!validId(transfer.id)||transfer.size!==size||transfer.name!==name)fail('The computer did not confirm the selected original.');
  onTransfer?.(transfer.id);
  let acknowledged=checkOffset(transfer.offset,size);onProgress?.(acknowledged,size);
  const hash=sha256.create();
  for(let offset=0;offset<size;){
   signal?.throwIfAborted();const length=Math.min(limits.chunkBytes,size-offset,offset<acknowledged?acknowledged-offset:Infinity);
   const bytes=await read(offset,length);signal?.throwIfAborted();
   if(!(bytes instanceof Uint8Array)||bytes.length!==length)fail('The selected file changed. Select it again.');
   hash.update(bytes);
   if(offset>=acknowledged){
    let done=false;
    for(let attempt=0;attempt<3&&!done;attempt++){
     try{
      const status=await request(`/upload-transfers/${transfer.id}?offset=${offset}`,{method:'PUT',body:bytes,mediaType:'application/octet-stream',signal});
      if(checkOffset(status.offset,size)!==offset+length)fail('The computer acknowledged different file bytes.');
      done=true;
     }catch(error){
      signal?.throwIfAborted();
      if(error.code==='upload_protocol'||(error.status>=400&&error.status<500&&![408,409,429].includes(error.status)))throw error;
      let status;
      for(let recovery=0;recovery<3;recovery++){
       try{status=await request(`/upload-transfers/${transfer.id}`,{signal});break;}
       catch(statusError){signal?.throwIfAborted();if(recovery===2||(statusError.status>=400&&statusError.status<500))throw statusError;await pause([50,200,800][recovery],signal);}
      }
      const next=checkOffset(status.offset,size);
      if(next===offset+length)done=true;
      else if(next!==offset||attempt===2)throw error;
     }
    }
    acknowledged=offset+length;onProgress?.(acknowledged,size);
   }
   offset+=length;
  }
  signal?.throwIfAborted();const digest=hex(hash.digest());
  if(expectedSha256&&expectedSha256!==digest)fail('The selected file changed. Select it again.');
  const receipt=await request(`/upload-transfers/${transfer.id}/complete`,{method:'POST',json:{sha256:digest},signal});
  if(receipt.receiptId!==transfer.id||receipt.name!==name||receipt.size!==size||receipt.sha256!==digest)fail('The computer did not verify the complete original file.');
  return {...receipt,protocol:2};
 }catch(error){
  // Network interruption keeps a bounded, expiring partial upload for a later retry.
  // Explicit cancellation and permanent protocol failures discard only this phone's transfer.
  if(validId(transfer?.id)&&(signal?.aborted||error.code==='upload_protocol'||(error.status>=400&&error.status<500&&![408,429].includes(error.status))))await request(`/upload-transfers/${transfer.id}`,{method:'DELETE'}).catch(()=>{});
  throw error;
 }
}
