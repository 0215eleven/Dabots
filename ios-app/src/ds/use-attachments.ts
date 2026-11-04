import {useSharedValue} from 'react-native-reanimated';
import {useEffect,useRef,useState} from 'react';
import {File,Paths} from 'expo-file-system';
import type {MobileClient} from '@ds-bot/mobile-sdk';
import {useChatAttachments} from '@/features/chat/components/use-chat-attachments';
import {MOBILE_UPLOAD_LIMITS,uploadAttachments,validateSelectedUploads} from '../logic/upload-attachments';

// Only copies created in this App's picker cache can be removed. A selected
// original document/photo, including any URI outside these folders, is never deleted.
function discardCopy(uri?:string){try{if(uri&&['DocumentPicker/','ImagePicker/'].some(folder=>uri.startsWith(Paths.cache.uri+folder))&&!decodeURIComponent(uri).includes('..'))new File(uri).delete();}catch{}}
export function useAttachments(){
 const attachments=useChatAttachments([],async items=>{validateSelectedUploads(items)},()=>({eml:false,media:false,zip:false,mp4:false}),{bytes:MOBILE_UPLOAD_LIMITS.maxBytes,count:MOBILE_UPLOAD_LIMITS.maxFiles});
 const menuProgress=useSharedValue(0);
 const previous=useRef(attachments.items),controller=useRef<AbortController|null>(null),active=useRef(true);
 const [uploading,setUploading]=useState(false);
 useEffect(()=>{const ids=new Set(attachments.items.map(item=>item.id));for(const item of previous.current)if(!ids.has(item.id))discardCopy(item.uri);previous.current=attachments.items},[attachments.items]);
 useEffect(()=>{active.current=true;return()=>{active.current=false;controller.current?.abort();for(const item of previous.current)discardCopy(item.uri)}},[]);
 return {...attachments,menuProgress,preparing:attachments.preparing||uploading,uploading,cancelUpload:()=>controller.current?.abort(),
  async upload(client:MobileClient,conversationId:string){if(controller.current)throw Error('An upload is already in progress.');const request=new AbortController();controller.current=request;setUploading(true);try{return await uploadAttachments(client,conversationId,attachments.items,request.signal)}finally{controller.current=null;if(active.current)setUploading(false)}}};
}
