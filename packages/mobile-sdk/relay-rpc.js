// BOT-specific bounded RPC over authenticated relay records. No network destinations.
import {encode,decode} from '@stablelib/base64';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_BODY=8*1024*1024,CHUNK=32768,MAX_PENDING=32;
const routes=[['GET',/^info$/],['POST',/^pairings(?:\/complete)?$/],['POST',/^auth\/refresh$/],['GET',/^(?:state|conversations|devices)$/],['GET',/^conversations\/[^/]+\/(?:messages|target)$/],['POST',/^conversations\/[^/]+\/cancel$/],['POST',/^(?:submissions|actions|read-markers|uploads|transcriptions)$/],['GET',/^(?:submissions|attachments)\/[^/]+$/],['DELETE',/^devices\/[^/]+$/]];
export function validateRelayRequest({method='GET',path,headers={}}){
 if(typeof path!=='string'||path.length>8192||!path.startsWith('/mobile/v1/')||/[\\#\u0000-\u0020]/.test(path)||/%(?:2f|5c|25)/i.test(path))throw Error('Invalid relay path.');
 const [pathname]=path.split('?');const segments=pathname.split('/');
 for(const segment of segments){const plain=decodeURIComponent(segment);if(plain==='.'||plain==='..')throw Error('Invalid relay path.');}
 const url=new URL(path,'https://bridge.invalid');
 if(!routes.some(([verb,pattern])=>verb===method&&pattern.test(url.pathname.slice(11))))throw Error('Relay endpoint denied.');
 for(const key of url.searchParams.keys())if(!['cursor','limit','conversationId','sessionId','seq','name','mediaType'].includes(key))throw Error('Relay query denied.');
 const clean={};new Headers(headers).forEach((value,key)=>{if(!['authorization','content-type','accept'].includes(key)||value.length>4096)throw Error('Relay header denied.');clean[key]=value;});
 return {method,path,headers:clean};
}
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
export function createRpcPeer({send,onHttp,onSocket,onFatal=()=>{},budget={used:0,maximum:16*1024*1024}}){
 const pending=new Map(),running=new Map(),transfers=new Map(),activeTransfers=new Set(),sockets=new Map(),localSockets=new Map();let closed=false,next=0,queue=Promise.resolve();
 const id=()=>String(++next);
 function emit(message){if(closed)return Promise.reject(Error('Relay disconnected.'));const operation=queue.then(()=>{if(closed)throw Error('Relay disconnected.');return send(message);});queue=operation.catch(()=>{close();});return operation;}
 function release(transfer){if(transfer.released)return;transfer.released=true;clearTimeout(transfer.timer);budget.used-=transfer.bytes.length;}
 function close(code=1006,reason='Relay disconnected'){
  if(closed)return;closed=true;
  for(const value of pending.values()){clearTimeout(value.timer);value.cleanup();value.reject(Error('Relay request interrupted; check its receipt before retrying.'));}pending.clear();
  for(const controller of running.values())controller.abort();running.clear();
  for(const transfer of transfers.values())release(transfer);transfers.clear();
  for(const transfer of activeTransfers)release(transfer);activeTransfers.clear();
  for(const socket of localSockets.values()){socket.readyState=3;socket.onclose?.({code,reason});}localSockets.clear();
  for(const socket of sockets.values())socket.close();sockets.clear();
 }
 async function body(meta,bytes=new Uint8Array(),active=()=>true){
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BODY)throw Error('Relay body limit exceeded.');const transferId=id();
  if(!active())throw Error('Relay operation cancelled.');await emit({kind:'transfer.start',id:transferId,meta,length:bytes.length});
  for(let offset=0;offset<bytes.length;offset+=CHUNK){if(!active())throw Error('Relay operation cancelled.');const chunk=bytes.subarray(offset,offset+CHUNK);await emit({kind:'transfer.chunk',id:transferId,offset,data:encode(chunk),final:offset+chunk.length===bytes.length});}
 }
 async function dispatch(meta,bytes){
  if(!validId(meta?.id))throw Error('Invalid RPC ID.');
  if(meta.kind==='http.response'){
   const request=pending.get(meta.id);if(!request)return;
   if(!Number.isInteger(meta.status)||meta.status<200||meta.status>599)throw Error('Invalid response status.');
   const headers={};if(meta.headers?.['content-type'])headers['content-type']=String(meta.headers['content-type']).slice(0,256);
   pending.delete(meta.id);clearTimeout(request.timer);request.cleanup();request.resolve({status:meta.status,headers,body:bytes});return;
  }
  if(meta.kind==='ws.message'){const socket=localSockets.get(meta.id);if(socket){socket.onmessage?.({data:decoder.decode(bytes)});return;}const remote=sockets.get(meta.id);if(remote){remote.send(decoder.decode(bytes));return;}return;}
  if(meta.kind!=='http.request'||!onHttp||running.has(meta.id)||running.size>=MAX_PENDING)throw Error('RPC request denied.');
  const request=validateRelayRequest(meta),controller=new AbortController();running.set(meta.id,controller);
  try{const response=await onHttp({...request,body:bytes,signal:controller.signal});if(!controller.signal.aborted&&!closed)await body({kind:'http.response',id:meta.id,status:response.status,headers:response.headers??{}},response.body??new Uint8Array());}
  catch{if(!closed&&!controller.signal.aborted)await emit({kind:'rpc.error',id:meta.id});}
  finally{running.delete(meta.id);}
 }
 async function handle(message){
  if(closed)return;
  if(!message||typeof message.kind!=='string')throw Error('Invalid RPC message.');
  if(message.kind==='transfer.start'){
   if(!validId(message.id)||transfers.has(message.id)||transfers.size>=MAX_PENDING||!Number.isSafeInteger(message.length)||message.length<0||message.length>MAX_BODY||!message.meta||budget.used+message.length>budget.maximum)throw Error('Relay transfer denied.');
   if(message.length===0){void dispatch(message.meta,new Uint8Array()).catch(fail);return;}
   budget.used+=message.length;const value={bytes:new Uint8Array(message.length),offset:0,meta:message.meta};value.timer=setTimeout(()=>{fail();},125000);value.timer.unref?.();transfers.set(message.id,value);return;
  }
  if(message.kind==='transfer.chunk'){
   const value=transfers.get(message.id);if(!value||message.offset!==value.offset||typeof message.data!=='string'||message.data.length>44000)throw Error('Invalid relay chunk.');
   const chunk=decode(message.data);if(!chunk.length||chunk.length>CHUNK||value.offset+chunk.length>value.bytes.length)throw Error('Invalid relay chunk.');
   value.bytes.set(chunk,value.offset);value.offset+=chunk.length;
   if(Boolean(message.final)!==(value.offset===value.bytes.length))throw Error('Invalid final relay chunk.');
   if(message.final){transfers.delete(message.id);activeTransfers.add(value);void dispatch(value.meta,value.bytes).catch(fail).finally(()=>{activeTransfers.delete(value);release(value);});}return;
  }
  if(!validId(message.id))throw Error('Invalid RPC ID.');
  if(message.kind==='http.cancel'){running.get(message.id)?.abort();for(const [key,value] of transfers)if(value.meta.id===message.id){transfers.delete(key);release(value);}return;}
  if(message.kind==='rpc.error'){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);request.cleanup();request.reject(Error('Relay upstream unavailable.'));}return;}
  if(message.kind==='ws.open'){
   if(!onSocket||message.path!=='/mobile/v1/events'||sockets.has(message.id)||sockets.size>=5)throw Error('Relay socket denied.');
   const connection=await onSocket(message.path,{message:text=>body({kind:'ws.message',id:message.id},encoder.encode(text)).catch(fail),close:(code=1000,reason='')=>{sockets.delete(message.id);void emit({kind:'ws.close',id:message.id,code,reason:String(reason).slice(0,120)}).catch(()=>{});}});
   if(closed){connection.close();return;}sockets.set(message.id,connection);await emit({kind:'ws.opened',id:message.id});return;
  }
  if(message.kind==='ws.opened'){const socket=localSockets.get(message.id);if(socket&&socket.readyState===0){socket.readyState=1;socket.onopen?.({});}return;}
  if(message.kind==='ws.close'){
   const code=Number.isInteger(message.code)&&message.code>=1000&&message.code<=4999?message.code:1006;
   const socket=localSockets.get(message.id);localSockets.delete(message.id);if(socket){socket.readyState=3;socket.onclose?.({code,reason:String(message.reason??'').slice(0,120)});}const remote=sockets.get(message.id);sockets.delete(message.id);remote?.close(code);return;
  }
  throw Error('Unknown RPC operation.');
 }
 function fail(){close();onFatal();}
 function receive(message){void handle(message).catch(fail);}
 async function request({method='GET',path,headers={},body:bytes=new Uint8Array(),signal}){
  const safe=validateRelayRequest({method,path,headers});if(closed||signal?.aborted||pending.size>=MAX_PENDING)throw Error('Relay request unavailable.');const requestId=id();
  return new Promise((resolve,reject)=>{
   const abort=()=>{const entry=pending.get(requestId);if(!entry)return;pending.delete(requestId);clearTimeout(entry.timer);entry.cleanup();void emit({kind:'http.cancel',id:requestId}).catch(()=>{});reject(Error('Relay request cancelled.'));};
   const timer=setTimeout(abort,125000);timer.unref?.();const cleanup=()=>signal?.removeEventListener('abort',abort);pending.set(requestId,{resolve,reject,timer,cleanup});signal?.addEventListener('abort',abort,{once:true});
   void body({kind:'http.request',id:requestId,...safe},bytes,()=>pending.has(requestId)).catch(()=>{const entry=pending.get(requestId);if(entry){pending.delete(requestId);clearTimeout(timer);cleanup();reject(Error('Relay request interrupted.'));}});
  });
 }
 function openSocket(path){
  if(closed||path!=='/mobile/v1/events'||localSockets.size>=5)throw Error('Relay socket unavailable.');const socketId=id();
  const socket={readyState:0,onopen:null,onmessage:null,onerror:null,onclose:null,
   send(text){if(socket.readyState!==1||typeof text!=='string')throw Error('Relay socket not open.');void body({kind:'ws.message',id:socketId},encoder.encode(text)).catch(fail);},
   close(code=1000,reason=''){if(socket.readyState===3)return;socket.readyState=3;localSockets.delete(socketId);void emit({kind:'ws.close',id:socketId,code,reason}).catch(()=>{});socket.onclose?.({code,reason});}};
  localSockets.set(socketId,socket);void emit({kind:'ws.open',id:socketId,path}).catch(fail);return socket;
 }
 return {request,openSocket,receive,close};
}
