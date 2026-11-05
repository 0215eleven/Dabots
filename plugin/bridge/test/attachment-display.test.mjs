import test from 'node:test'
import assert from 'node:assert/strict'
import {decorateAttachmentMessage} from '../src/attachment-display.mjs'
const hash='sha256:'+'a'.repeat(64)
const photo={id:hash,type:'file',name:'original.png',size:201461},preview={id:hash,type:'image',name:'a user-chosen name.png',size:71082,mediaType:'image/png',previewAvailable:true,width:40,height:30}
const row={requestId:'phone_request_1',sessionId:'chat',seq:7,role:'user',attachments:[photo,preview]}
const entry={receipt:{conversationId:'chief',sessionId:'chat'},attachmentBindings:[{originalId:hash,originalIndex:0,previewIndex:1}]}
test('durable request/session ordinal proof combines a photo and preview even when hashes match',()=>{
 const restarted=JSON.parse(JSON.stringify({'phone:request_1':entry}))
 const result=decorateAttachmentMessage(row,restarted,'chief')
 assert.equal(result.attachments.length,1);assert.equal(result.attachments[0].name,'original.png');assert.equal(result.attachments[0].size,201461)
 assert.equal(result.attachments[0].preview.id,hash);assert.equal(result.attachments[0].preview.size,71082)
 assert.equal(row.attachments.length,2)
})
test('old history, different conversation/session, changed hash and fake preview filenames never hide files',()=>{
 for(const [message,entries,conversation] of [[row,{},'chief'],[row,{'phone:request_1':entry},'other'],[{...row,sessionId:'other'},{'phone:request_1':entry},'chief'],[{...row,attachments:[{...photo,id:'sha256:'+'b'.repeat(64)},preview]},{'phone:request_1':entry},'chief']]){
  assert.equal(decorateAttachmentMessage(message,entries,conversation).attachments.length,2)
 }
 const plain={...row,requestId:undefined,attachments:[photo,{...preview,name:'Model preview - original.png'}]}
 assert.equal(decorateAttachmentMessage(plain,{},'chief').attachments.length,2)
})
test('malformed or overlapping binding records fail closed without hiding an independent attachment',()=>{
 for(const attachmentBindings of [[{originalId:hash,originalIndex:0,previewIndex:0}],[{originalId:hash,originalIndex:0,previewIndex:9}],[{originalId:hash,originalIndex:-1,previewIndex:1}]]){
  assert.equal(decorateAttachmentMessage(row,{'phone:request_1':{...entry,attachmentBindings}},'chief').attachments.length,2)
 }
})
