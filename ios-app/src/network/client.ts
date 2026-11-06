import { requireOptionalNativeModule } from "expo";
import { Platform,AppState } from "react-native";
import { ClientOptions, MobileClient, validateServerUrl, validateTlsPin,previewBase64,previewMime } from "@ds-bot/mobile-sdk";
import {File} from 'expo-file-system';
import { createRelayTransport, type RelayHost } from "@ds-bot/mobile-sdk/relay-transport";
import * as Crypto from "expo-crypto";
import { relayPhoneKey } from "../storage/relay-key";
import { signPhoneConnection } from "../logic/relay-access";
import { relayOrigin } from "../logic/pairing";
import { officialRelay } from "../logic/hosts";
import {createResponseRemover} from '../ds/preview-cleanup';
interface NativeResponse { status:number; headers:Record<string,string>; bodyText?:string; bodyFile?:string; fileId?:string }
interface SocketEvent { id:string; type:string; data?:string; code?:number; reason?:string }
interface Transport {
  request(input:Record<string,unknown>):Promise<NativeResponse>;
  cancel(id:string):Promise<void>;
  removeResponseFile(id:string):Promise<boolean>;
  connect(origin:string,pin:string,id:string,url:string):Promise<void>;
  send(id:string,text:string):Promise<void>;
  close(id:string):Promise<void>;
  addListener(name:"socket",listener:(event:SocketEvent)=>void):{remove():void};
}
const native = requireOptionalNativeModule<Transport>("DSBotLocalTLS");
const responseCleanup=native?createResponseRemover({removePreviewFile:id=>native.removeResponseFile(id)}):null;
if(responseCleanup)AppState?.addEventListener('change',state=>{if(state==='active')void responseCleanup.retryPending();});
let sequence=0;
const requestId=()=>`local-${Date.now()}-${++sequence}`;
function base64(bytes:Uint8Array) {
  let raw="";
  for(let offset=0;offset<bytes.length;offset+=8192) raw+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(raw);
}
function encodeBody(body:RequestInit["body"]) {
  if(body==null)return undefined;
  if(typeof body==="string")return btoa(encodeURIComponent(body).replace(/%([0-9A-F]{2})/g,(_,hex:string)=>String.fromCharCode(parseInt(hex,16))));
  if(body instanceof ArrayBuffer)return base64(new Uint8Array(body));
  if(ArrayBuffer.isView(body))return base64(new Uint8Array(body.buffer,body.byteOffset,body.byteLength));
  throw new Error("This upload format is unavailable.");
}
// The relay transport encrypts end to end and stands in for fetch and WebSocket;
// its key identity is stored like a TLS pin so a changed computer is noticed.
function createRelayClient(options:Omit<ClientOptions,"baseUrl"|"tlsPin">,relay:RelayHost&{requireAccess?:boolean}):MobileClient {
  const official=officialRelay();
  const transport=createRelayTransport({...relay,requireAccess:relay.requireAccess===true || (!!official && relayOrigin(relay.relay)===relayOrigin(official)),
    authenticate:async challenge=>{
      if(relayOrigin(challenge.relay)!==relayOrigin(relay.relay) || challenge.computerId!==relay.computerId || challenge.computerKey!==relay.computerKey || challenge.serverId!==relay.serverId) throw new Error("The computer identity does not match this connection.");
      return signPhoneConnection(challenge,await relayPhoneKey(relay.relay));
    },
    randomBytes:length=>Crypto.getRandomBytes(length),WebSocket:globalThis.WebSocket});
  const relayFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const response=await transport.fetch(input,init) as Response;
    if(Platform.OS==="web")return response;
    // React Native cannot build a Blob from bytes; go through a data URI instead.
    return Object.assign(response,{attachmentData:async({signal}:{maximum:number;signal?:AbortSignal})=>{
      signal?.throwIfAborted();const mimeType=previewMime(response.headers.get('content-type'));
      const bytes=new Uint8Array(await response.arrayBuffer());signal?.throwIfAborted();
      return {mimeType,base64:previewBase64(bytes)};
    },blob:async()=>{
      const type=response.headers.get("content-type")||"application/octet-stream";
      const file=await fetch(`data:${type};base64,${base64(new Uint8Array(await response.arrayBuffer()))}`);
      return file.blob();
    }});
  }) as typeof fetch;
  const client=new MobileClient({...options,baseUrl:transport.baseUrl,tlsPin:transport.tlsPin,fetch:relayFetch,WebSocket:transport.WebSocket});
  const dispose=client.dispose.bind(client);
  client.dispose=()=>{dispose();transport.dispose();};
  return client;
}
export function createMobileClient(options:ClientOptions&{relay?:RelayHost&{requireAccess?:boolean}}):MobileClient {
  const {relay,...rest}=options;
  if(relay)return createRelayClient(rest,relay);
  options=rest;
  if(options.tlsPin===undefined)return new MobileClient(options);
  const pin=validateTlsPin(options.tlsPin),origin=validateServerUrl(options.baseUrl);
  if(!native || Platform.OS==="web")throw new Error("Install the latest native app to connect to local HTTPS.");
  const transport=native;
  const pinnedFetch=async(input:RequestInfo|URL,init:RequestInit={})=>{
    const id=requestId();
    if(init.signal?.aborted)throw new Error("The request was cancelled.");
    const headers:Record<string,string>={};new Headers(init.headers).forEach((value,key)=>{headers[key] = value;});
    const abort=()=>{void transport.cancel(id).catch(()=>{});};
    init.signal?.addEventListener("abort",abort,{once:true});
    try {
      const response=await transport.request({origin,pin,id,url:String(input),method:init.method??"GET",headers,body:encodeBody(init.body)});
      if(init.signal?.aborted){if(response.fileId)await responseCleanup?.remove(response.fileId);throw new Error("The request was cancelled.");}
      const text=response.bodyText??"";
      const responseHeaders=new Headers(response.headers);
      let released=false;const releaseAttachment=async()=>{if(released||!response.fileId)return;released=await responseCleanup!.remove(response.fileId);};
      return Object.assign(new Response(text||null,{status:response.status,headers:responseHeaders}),{releaseAttachment,
        attachmentData:async({maximum,signal}:{maximum:number;signal?:AbortSignal})=>{
          try{
            signal?.throwIfAborted();
            let location:URL;try{location=new URL(response.bodyFile??'invalid:');}catch{throw Object.assign(new Error('This image preview is unavailable.'),{code:'preview_read'});}
            if(location.protocol!=='file:'||location.hostname||location.search||location.hash||!response.fileId)throw Object.assign(new Error('This image preview is unavailable.'),{code:'preview_read'});
            const file=new File(location.href);
            if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>maximum)throw Object.assign(new Error('This image preview is unavailable.'),{code:file.size>maximum?'preview_size':'preview_empty'});
            const value={mimeType:previewMime(responseHeaders.get('content-type')),base64:await file.base64()};signal?.throwIfAborted();return value;
          }finally{await releaseAttachment();}
        },
        blob:async()=>{
          if(!response.bodyFile || !response.fileId)throw new Error("The host did not return a downloadable attachment.");
          try {
            const file=await fetch(response.bodyFile),blob=await file.blob();
            const type=responseHeaders.get("content-type")?.split(";")[0].trim();
            return type ? blob.slice(0,blob.size,type) : blob;
          }
          finally {await releaseAttachment();}
        },
      });
    } finally {init.signal?.removeEventListener("abort",abort);}
  };
  class PinnedSocket {
    readyState=0;
    onopen:((event:unknown)=>void)|null=null;
    onmessage:((event:{data:string})=>void)|null=null;
    onerror:((event:unknown)=>void)|null=null;
    onclose:((event:{code:number;reason:string})=>void)|null=null;
    private id=requestId();
    private subscription:{remove():void};
    constructor(url:string) {
      this.subscription=transport.addListener("socket",event=>{
        if(event.id!==this.id || this.readyState===3)return;
        if(event.type==="open"){if(this.readyState!==0)return;this.readyState=1;this.onopen?.({});}
        if(event.type==="message")this.onmessage?.({data:event.data??""});
        if(event.type==="error")this.onerror?.({});
        if(event.type==="close")this.finish(event.code??1006,event.reason??"");
      });
      void transport.connect(origin,pin,this.id,url).catch(()=>{if(this.readyState===3)return;this.onerror?.({});this.finish(1006,"");});
    }
    private finish(code:number,reason:string) {if(this.readyState===3)return;this.readyState=3;this.subscription.remove();this.onclose?.({code,reason});}
    send(text:string) {if(this.readyState!==1)throw new Error("The stream closed.");void transport.send(this.id,text).catch(()=>{this.onerror?.({});this.close();});}
    close(){if(this.readyState>=2)return;this.readyState=2;void transport.close(this.id).catch(()=>{}).finally(()=>this.finish(1000,""));}
  }
  return new MobileClient({...options,fetch:pinnedFetch,WebSocket:PinnedSocket as unknown as typeof WebSocket});
}
