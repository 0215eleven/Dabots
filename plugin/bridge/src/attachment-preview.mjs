import {BridgeError} from './auth.js'

export const PREVIEW_LIMITS=Object.freeze({bytes:1048576,edge:1536,sourceBytes:4194304,sourceEdge:2048,sourcePixels:4194304})
const types=new Set(['image/png','image/jpeg','image/webp'])
const id=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value)
const positive=value=>Number.isSafeInteger(value)&&value>0
const denied=()=>{throw new BridgeError(404,'PREVIEW_UNAVAILABLE','This message has no readable image preview.')}
export function safePreviewReference(ref){
 return !!ref&&id(ref.attachmentId)&&types.has(ref.mediaType)&&positive(ref.bytes)&&ref.bytes<=PREVIEW_LIMITS.sourceBytes
  &&positive(ref.width)&&positive(ref.height)&&Math.max(ref.width,ref.height)<=PREVIEW_LIMITS.sourceEdge&&ref.width*ref.height<=PREVIEW_LIMITS.sourcePixels
}
/** Resolve only a visible canonical image; never turn a client hash into a file path. */
export function createPreviewReader({authorize,project,sessionController,attachmentStore}){
 return async(input,signal=AbortSignal.timeout(30000),access)=>{
  if(typeof attachmentStore?.readImageRequest!=='function')throw new BridgeError(501,'UNSUPPORTED','Image previews require an updated desktop plugin.')
  if(!input||!id(input.attachmentId)||!Number.isSafeInteger(input.seq)||input.seq<0)throw new BridgeError(400,'INVALID_PREVIEW','Choose an image from an exact conversation message.')
  signal.throwIfAborted()
  const item=await authorize(input,signal,access)
  const page=await sessionController.page({address:{kind:'session',sessionId:input.sessionId},throughSeq:input.seq,maxMessages:1},signal)
  const records=page.records??[]
  const visible=async target=>{
   const rows=await project(records,target,input.sessionId,signal)
   if(!rows.some(row=>row.seq===input.seq&&row.attachments?.some(a=>a.type==='image'&&a.id===input.attachmentId)))denied()
  }
  await visible(item)
  const record=records.find(r=>r.event?.seq===input.seq)?.event
  const content=record?.type==='assistant/message'?record.data?.message?.content:record?.type==='user/message'?record.data?.content:undefined
  const ref=(Array.isArray(content)?content:[]).find(part=>part?.type==='image'&&part.attachment?.attachmentId===input.attachmentId)?.attachment
  if(!safePreviewReference(ref))denied()
  signal.throwIfAborted()
  const result=await attachmentStore.readImageRequest(ref,{width:PREVIEW_LIMITS.edge,height:PREVIEW_LIMITS.edge,maxBytes:524288},signal)
  signal.throwIfAborted()
  if(!(result?.data instanceof Uint8Array)||!positive(result.data.length)||result.data.length>PREVIEW_LIMITS.bytes||result.bytes!==result.data.length
   ||!types.has(result.mediaType)||!positive(result.width)||!positive(result.height)||Math.max(result.width,result.height)>PREVIEW_LIMITS.edge)denied()
  // A device/Agent grant, conversation membership or visibility can change while decoding.
  await visible(await authorize(input,signal,access));signal.throwIfAborted()
  return {bytes:Buffer.from(result.data),mediaType:result.mediaType}
 }
}
