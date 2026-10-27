import {EventEmitter} from 'node:events'
import {Readable} from 'node:stream'
// Internal adapter only: no TCP/DNS/proxy destination and no owner operator path.
export function createRelayEndpoint({remoteKey,route,acceptSocket}) {
 if(typeof remoteKey!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(remoteKey))throw Error('Invalid relay stream')
 const remoteAddress=`relay:${remoteKey}`
 return {
  request({method,path,headers,body=new Uint8Array(),signal}){
   if(!path.startsWith('/mobile/v1/')||path.includes('://')||headers?.origin)throw Error('Relay mobile route required')
   if(signal?.aborted)return Promise.reject(Error('Relay request cancelled'))
   return new Promise((resolve,reject)=>{
    const request=Readable.from([Buffer.from(body)]);Object.assign(request,{method,url:path,headers:headers??{},socket:{remoteAddress}})
    const response=new EventEmitter();let responseHeaders={},finished=false
    response.writableEnded=false;response.headersSent=false
    response.setHeader=(key,value)=>{responseHeaders[key.toLowerCase()]=value}
    response.writeHead=(status,values={})=>{response.statusCode=status;response.headersSent=true;for(const [key,value] of Object.entries(values))response.setHeader(key,value)}
    const abort=()=>{if(finished)return;finished=true;signal?.removeEventListener('abort',abort);response.emit('close');request.destroy();reject(Error('Relay request cancelled'))}
    response.end=data=>{if(finished)return;finished=true;response.writableEnded=true;signal?.removeEventListener('abort',abort);resolve({status:response.statusCode??200,headers:responseHeaders,body:new Uint8Array(Buffer.from(data??''))});response.emit('close')}
    signal?.addEventListener('abort',abort,{once:true})
    void route(request,response).catch(()=>{if(!finished){finished=true;signal?.removeEventListener('abort',abort);reject(Error('Relay route unavailable'))}})
   })
  },
  socket(path,events){
   if(path!=='/mobile/v1/events')throw Error('Relay event route required')
   const socket=new EventEmitter();socket.readyState=1;socket.bufferedAmount=0
   socket.send=data=>{if(socket.readyState!==1)return;const text=String(data),size=Buffer.byteLength(text);socket.bufferedAmount+=size;Promise.resolve(events.message(text)).finally(()=>{socket.bufferedAmount-=size}).catch(()=>socket.terminate())}
   socket.close=(code=1000,reason='')=>{if(socket.readyState===3)return;socket.readyState=3;socket.emit('close');events.close(code,reason)}
   socket.terminate=()=>socket.close(1006,'Relay closed')
   socket.ping=()=>queueMicrotask(()=>{if(socket.readyState===1)socket.emit('pong')})
   acceptSocket(socket)
   return {send:data=>{if(socket.readyState===1)socket.emit('message',Buffer.from(data))},close:(code,reason)=>socket.close(code,reason)}
  },
 }
}
