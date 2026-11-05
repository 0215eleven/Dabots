import type {MobileText} from '@/shared/lib/text';
import {MOBILE_UPLOAD_LIMITS,type UploadSelectionError} from '../logic/upload-attachments';

export function selectionErrorMessage(error:UploadSelectionError,{t,format}:Pick<MobileText,'t'|'format'>,limits=MOBILE_UPLOAD_LIMITS){
 const bytes=(value:number)=>value%1000000===0?`${format.number(value/1000000)} MB`:value%1048576===0?`${format.number(value/1048576)} MiB`:`${format.number(value)} B`;
 switch(error.reason){
  case 'count':case 'total':return t('mobile.chat.attachment.uploadBounds',{count:limits.maxFiles,limit:bytes(limits.maxTotalBytes)});
  case 'size':return t('mobile.chat.attachment.tooLarge',{name:error.fileName,limit:bytes(limits.maxBytes)});
  case 'type':return t('mobile.chat.attachment.uploadTypes',{name:error.fileName});
  case 'name':return t('mobile.chat.attachment.invalidName');
  case 'damaged':return t('mobile.chat.attachment.damaged');
  case 'quota':return t('mobile.chat.attachment.cacheFull');
 }
}

export function uploadErrorMessage(error:unknown,{t}:Pick<MobileText,'t'>){
 const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
 if(code==='cancelled'||(error instanceof Error&&error.name==='AbortError'))return t('mobile.chat.upload.cancelled');
 if(['unsupported_upload','UNSUPPORTED','STABLE_UPLOAD_REQUIRED'].includes(code))return t('mobile.chat.attachment.updateRequired');
 if(['UPLOAD_QUOTA','UPLOAD_BUSY'].includes(code))return t('mobile.chat.attachment.hostFull');
 if(['TARGET_CHANGED','UPLOAD_EXPIRED','UPLOAD_BOUND','AGENT_ACCESS_REQUIRED','UNAUTHORIZED'].includes(code))return t('mobile.chat.attachment.targetChanged');
 return t('mobile.chat.attachment.unavailable');
}
