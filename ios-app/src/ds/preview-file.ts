import {requireOptionalNativeModule} from 'expo';
import {materializePreview,type PreviewFileAPI} from './preview-resource';
import {PreviewError} from './attachment-preview';
import {AppState} from 'react-native';
import {previewRemover} from './preview-cleanup';
const native=requireOptionalNativeModule<PreviewFileAPI>('DSBotLocalTLS');
const api=native&&typeof native.createPreviewFile==='function'&&typeof native.removePreviewFile==='function'?native:null;
// Protected iOS files may be unavailable while locked. Reattempt retained handles on unlock/foreground.
if(api)AppState.addEventListener('change',state=>{if(state==='active')void previewRemover(api).retryPending();});
/** Older native builds keep validated in-memory images; no persistent JS disk cache. */
export async function createPreviewFile(data:{base64:string;mimeType:string},signal?:AbortSignal){
 try{return await materializePreview(api,data,signal);}catch{signal?.throwIfAborted();throw new PreviewError('decode');}
}
