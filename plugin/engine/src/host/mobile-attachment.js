const images={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}
const documents=new Set(['txt','md','markdown','csv','json','jsonl','log','yaml','yml','xml','pdf','doc','docx','xls','xlsx','ppt','pptx'])
export function mobileUpload(part){
 if(!part||!['image','file-upload'].includes(part.type)||Object.keys(part).some(key=>!['type','name','mediaType','data'].includes(key))||typeof part.name!=='string'||!part.name.trim()||part.name.length>255||/[\p{Cc}\p{Zl}\p{Zp}/\\:]/u.test(part.name))throw Error('Invalid attachment')
 const extension=part.name.split('.').at(-1).toLowerCase()
 if(part.type==='image'?images[extension]!==part.mediaType:!documents.has(extension))throw Error('Unsupported attachment')
 if(typeof part.data!=='string'||part.data.length>Math.ceil(2*1024*1024/3)*4||!part.data||part.data.length%4||!(/^[A-Za-z0-9+/]*={0,2}$/u.test(part.data)))throw Error('Invalid attachment bytes')
 const bytes=Buffer.from(part.data,'base64');if(!bytes.length||bytes.length>2*1024*1024||bytes.toString('base64')!==part.data)throw Error('Invalid attachment bytes')
 return bytes
}
