/** Presentation links are local durable proofs, never inferred from display names. */
export function decorateAttachmentMessage(row,submissions,conversationId){
 if(row?.role!=='user'||typeof row.requestId!=='string'||!Array.isArray(row.attachments))return row
 const saved=submissions?.[row.requestId.replace('_',':')]
 if(saved?.receipt?.conversationId!==conversationId||saved.receipt.sessionId!==row.sessionId||!Array.isArray(saved.attachmentBindings)||saved.attachmentBindings.length>4)return row
 const replacements=new Map(),hidden=new Set(),used=new Set()
 for(const pair of saved.attachmentBindings){
  const a=pair?.originalIndex,b=pair?.previewIndex
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<=a||used.has(a)||used.has(b))continue
  const original=row.attachments[a],preview=row.attachments[b]
  if(original?.type!=='file'||original.id!==pair.originalId||preview?.type!=='image')continue
  used.add(a);used.add(b);hidden.add(b)
  replacements.set(a,{...original,photo:true,...(preview.previewAvailable===true?{preview:{id:preview.id,size:preview.size,mediaType:preview.mediaType,width:preview.width,height:preview.height}}:{})})
 }
 return replacements.size?{...row,attachments:row.attachments.flatMap((attachment,index)=>hidden.has(index)?[]:[replacements.get(index)??attachment])}:row
}
