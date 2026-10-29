import {encode,decode} from '@stablelib/base64';
import {sha256} from '@noble/hashes/sha2.js';
import {createPhoneHandshake} from './relay-crypto.js';
import {createRpcPeer} from './relay-rpc.js';
import {randomBytesFrom} from './vendor/happy-envelope.js';
const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const b64url=value=>encode(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function keyBytes(key){if(key instanceof Uint8Array&&key.length===32)return key.slice();if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))throw Error('Invalid computer key.');const value=decode(key.replace(/-/g,'+').replace(/_/g,'/')+'=');if(b64url(value)!==key)throw Error('Invalid computer key.');return value;}
const hex=value=>Array.from(value,x=>x.toString(16).padStart(2,'0')).join('');
async function binary(value){if(value instanceof ArrayBuffer)return new Uint8Array(value);if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);if(value?.arrayBuffer)return new Uint8Array(await value.arrayBuffer());throw Error('Invalid relay binary data.');}
function abortable(promise,signal){if(!signal)return promise;if(signal.aborted)return Promise.reject(Error('Request cancelled.'));return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(Error('Request cancelled.'));},cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});});}
export function createRelayTransport({relay,computerId,computerKey,serverId,randomBytes,WebSocket:Socket=globalThis.WebSocket,onStatus=()=>{}}){
 const origin=new URL(relay);if(origin.protocol!=='wss:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Invalid WSS relay origin.');
 if(typeof computerId!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(computerId)||typeof serverId!=='string'||!serverId||typeof Socket!=='function')throw Error('Invalid relay host.');
 const key=keyBytes(computerKey),baseUrl=`https://${hex(sha256(utf8.encode(computerId))).slice(0,32)}.relay.invalid`,tlsPin=`sha256:${hex(sha256(key))}`;
 let current=null,disposed=false;
 function connect(){
  if(disposed)return Promise.reject(Error('Relay transport disposed.'));if(current)return current.ready;
  const socket=new Socket(`${origin.origin}/v1/phone?computer=${encodeURIComponent(computerId)}`);socket.binaryType='arraybuffer';
  const state={socket,channel:null,rpc:null,queue:Promise.resolve(),ready:null,stop:null,queued:0};let resolveReady,rejectReady,settled=false;
  state.ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});state.ready.catch(()=>{});current=state;onStatus('connecting');
  const timer=setTimeout(()=>stop('RELAY_HANDSHAKE_TIMEOUT'),15000);
  function stop(code='RELAY_DISCONNECTED'){
   clearTimeout(timer);if(current===state)current=null;state.channel?.close();state.rpc?.close();if(!settled){settled=true;rejectReady(Object.assign(Error('Computer relay unavailable.'),{code}));}onStatus(code==='COMPUTER_OFFLINE'?'offline':'disconnected');try{socket.close();}catch{}
  }
  state.stop=stop;
  async function send(message){
   const deadline=Date.now()+10000;while(socket.bufferedAmount>1024*1024){if(Date.now()>deadline||current!==state)throw Error('Relay backpressure.');await new Promise(r=>setTimeout(r,5));}
   if(current!==state||socket.readyState!==1)throw Error('Relay disconnected.');socket.send(state.channel.send(message));
  }
  socket.onmessage=event=>{
   const size=typeof event.data==='string'?event.data.length:event.data?.byteLength??event.data?.size??0;
   if(size>1048576||state.queued+size>2*1048576){stop('RELAY_RESOURCE_LIMIT');return;}state.queued+=size;
   state.queue=state.queue.then(async()=>{
    if(current!==state)return;
    if(typeof event.data==='string'){
     if(state.channel)throw Error('Unexpected relay control.');const frame=JSON.parse(event.data);if(frame.type==='error'){stop(frame.code);return;}
     if(frame.type!=='connected'||typeof frame.streamId!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(frame.streamId))throw Error('Invalid relay stream.');
     const epoch=b64url(randomBytesFrom(randomBytes,32)),context={relay:origin.origin,computerId,serverId,streamId:frame.streamId,epoch};
     state.channel=createPhoneHandshake({computerKey:key,context,randomBytes});socket.send(utf8.encode(JSON.stringify({type:'offer',version:2,epoch,serverId,box:encode(state.channel.offer)})));return;
    }
    if(!state.channel)throw Error('Unexpected relay ciphertext.');const frame=state.channel.receive(await binary(event.data));
    if(!state.rpc){if(!(frame instanceof Uint8Array)||!state.channel.confirmed)throw Error('Relay confirmation failed.');socket.send(frame);state.rpc=createRpcPeer({send,onFatal:()=>stop('RELAY_PROTOCOL_ERROR')});clearTimeout(timer);settled=true;resolveReady(state.rpc);onStatus('ready');return;}
    state.rpc.receive(frame);
   }).catch(()=>stop('RELAY_PROTOCOL_ERROR')).finally(()=>{state.queued-=size;});
  };
  socket.onerror=()=>stop();socket.onclose=()=>stop();return state.ready;
 }
 function pathFor(input,websocket=false){const url=new URL(String(input));if(url.origin!==(websocket?baseUrl.replace('https:','wss:'):baseUrl))throw Error('Relay destination denied.');return url.pathname+url.search;}
 async function fetchRelay(input,init={}){
  const path=pathFor(input);if(init.signal?.aborted)throw Error('Request cancelled.');const rpc=await abortable(connect(),init.signal);let body=new Uint8Array();
  if(init.body!==undefined&&init.body!==null)body=typeof init.body==='string'?utf8.encode(init.body):await binary(init.body);
  if(init.signal?.aborted)throw Error('Request cancelled.');const response=await rpc.request({method:init.method??'GET',path,headers:init.headers??{},body,signal:init.signal});
  return {status:response.status,ok:response.status>=200&&response.status<300,headers:new Headers(response.headers),json:async()=>JSON.parse(decoder.decode(response.body)),arrayBuffer:async()=>response.body.slice().buffer,blob:async()=>new Blob([response.body],{type:response.headers['content-type']??'application/octet-stream'})};
 }
 class RelaySocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;onopen=null;onmessage=null;onerror=null;onclose=null;inner=null;
  constructor(url){const path=pathFor(url,true);if(path!=='/mobile/v1/events')throw Error('Relay socket path denied.');void connect().then(rpc=>{if(this.readyState===3)return;this.inner=rpc.openSocket(path);this.inner.onopen=e=>{this.readyState=1;this.onopen?.(e);};this.inner.onmessage=e=>this.onmessage?.(e);this.inner.onclose=e=>{if(this.readyState===3)return;this.readyState=3;this.onclose?.(e);};}).catch(()=>{if(this.readyState===3)return;this.onerror?.({});this.close(1006,'Relay unavailable');});}
  send(data){if(this.readyState!==1)throw Error('Relay socket not open.');this.inner.send(data);}
  close(code=1000,reason=''){if(this.readyState===3)return;this.readyState=3;this.inner?.close(code,reason);this.onclose?.({code,reason});}
 }
 return {baseUrl,tlsPin,fetch:fetchRelay,WebSocket:RelaySocket,dispose(){disposed=true;current?.stop('RELAY_DISPOSED');key.fill(0);},get connected(){return Boolean(current?.rpc);}};
}
