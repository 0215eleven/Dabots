import {createHash,createPublicKey,sign,randomBytes} from 'node:crypto'
import {WebSocket} from 'ws'
import {acceptPhoneHandshake,createRpcPeer} from './relay-shared.mjs'
export function createRelayConnector({relay,secret,identity,serverId,endpoint,Socket=WebSocket,onStatus=()=>{}}){
 const url=new URL(relay)
 if(url.protocol!=='wss:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||typeof secret!=='string'||Buffer.byteLength(secret)<32)throw Error('Invalid relay configuration')
 const edPublicKey=createPublicKey(identity.edPrivateKey).export({type:'spki',format:'der'}).subarray(-32).toString('base64url')
 const computerId=createHash('sha256').update(Buffer.from(edPublicKey,'base64url')).digest().subarray(0,16).toString('base64url')
 const computerKey=Buffer.from(identity.xPublicKey).toString('base64url')
 let stopped=false,socket=null,reconnect=null,attempts=0,state='connecting',queued=0,requests=0
 const streams=new Map(),budget={used:0,maximum:32*1024*1024}
 let resolveReady,rejectReady
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});ready.catch(()=>{})
 const status=()=>({relay:url.origin,state,ready:state==='ready',computerId,computerKey})
 const publish=value=>{state=value;onStatus(status())}
 function endStream(id,notify=true){const entry=streams.get(id);if(!entry)return;streams.delete(id);entry.closed=true;clearTimeout(entry.timer);entry.channel?.close();entry.rpc?.close();if(notify&&socket?.readyState===1)socket.send(JSON.stringify({type:'close',streamId:id}))}
 function connect(){
  if(stopped)return
  publish('connecting');const ws=new Socket(`${url.origin}/v1/computer`);socket=ws
  const timeout=setTimeout(()=>ws.terminate(),15000);timeout.unref()
  ws.on('error',()=>{})
  const write=async(entry,record)=>{
   const deadline=Date.now()+10000
   while(ws.bufferedAmount>1024*1024){if(entry.closed||Date.now()>deadline)throw Error('Relay backpressure');await new Promise(r=>setTimeout(r,5))}
   if(entry.closed||ws.readyState!==1)throw Error('Relay disconnected')
   ws.send(Buffer.concat([Buffer.from(entry.id,'base64url'),Buffer.from(record)]))
  }
  ws.on('message',(data,binary)=>{
   if(socket!==ws||stopped)return
   if(!binary){
    try{const value=JSON.parse(data.toString())
     if(value.type==='challenge'&&state==='connecting'){
      if(typeof value.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.nonce))throw Error('Invalid challenge')
      const payload=JSON.stringify(['ds-bot-computer-v2',url.origin,value.nonce,computerId,edPublicKey,computerKey])
      ws.send(JSON.stringify({type:'register',nonce:value.nonce,computerId,edPublicKey,computerKey,signature:sign(null,Buffer.from(payload),identity.edPrivateKey).toString('base64url'),secret}));return
     }
     if(value.type==='registered'&&value.computerId===computerId&&state==='connecting'){clearTimeout(timeout);attempts=0;publish('ready');resolveReady();return}
     if(state!=='ready')throw Error('Relay not registered')
     if(value.type==='open'){
      if(typeof value.streamId!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(value.streamId)||streams.has(value.streamId)||streams.size>=32)throw Error('Invalid stream')
      const entry={id:value.streamId,channel:null,rpc:null,queue:Promise.resolve(),bytes:0,closed:false,last:Date.now()}
      entry.timer=setTimeout(()=>endStream(entry.id),10000);entry.timer.unref();streams.set(entry.id,entry);return
     }
     if(value.type==='close'){endStream(value.streamId,false);return}
     throw Error('Unknown relay control')
    }catch{ws.close(4400,'INVALID_RELAY_CONTROL')}return
   }
   if(data.length<16||data.length>1048576){ws.close(4400,'INVALID_RELAY_FRAME');return}
   const id=data.subarray(0,16).toString('base64url'),entry=streams.get(id);if(!entry)return
   if(entry.bytes+data.length>2*1024*1024||queued+data.length>32*1024*1024){endStream(id);return}
   entry.bytes+=data.length;queued+=data.length;entry.last=Date.now()
   entry.queue=entry.queue.then(async()=>{
    if(entry.closed)return
    const frame=data.subarray(16)
    if(!entry.channel){
     if(frame.length>8192)throw Error('Invalid envelope')
     const offer=JSON.parse(frame.toString())
     if(offer.type!=='offer'||offer.version!==2||offer.serverId!==serverId||typeof offer.epoch!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(offer.epoch)||typeof offer.box!=='string')throw Error('Invalid session offer')
     entry.channel=acceptPhoneHandshake({offer:new Uint8Array(Buffer.from(offer.box,'base64')),computerSecret:identity.xSecretKey,context:{relay:url.origin,computerId,serverId,streamId:id,epoch:offer.epoch},randomBytes:n=>new Uint8Array(randomBytes(n))})
     await write(entry,entry.channel.ready);return
    }
    const value=entry.channel.receive(new Uint8Array(frame))
    if(!entry.rpc){
     if(value!==null||!entry.channel.confirmed)throw Error('Key confirmation failed')
     clearTimeout(entry.timer);const target=endpoint(id)
     entry.rpc=createRpcPeer({budget,send:async message=>{await write(entry,entry.channel.send(message))},onHttp:async request=>{if(requests>=128)throw Error('Request limit');requests++;try{return await target.request(request)}finally{requests--}},onSocket:(path,events)=>target.socket(path,events),onFatal:()=>endStream(id)});return
    }
    entry.rpc.receive(value)
   }).catch(()=>endStream(id)).finally(()=>{entry.bytes-=data.length;queued-=data.length})
  })
  ws.on('close',()=>{clearTimeout(timeout);if(socket!==ws)return;for(const id of streams.keys())endStream(id,false);socket=null;if(stopped)return;publish('offline');reconnect=setTimeout(connect,Math.min(30000,500*2**Math.min(attempts++,6)));reconnect.unref()})
 }
 const idle=setInterval(()=>{for(const [id,entry] of streams)if(Date.now()-entry.last>300000)endStream(id)},10000);idle.unref()
 connect()
 return {ready,status,close(){stopped=true;clearInterval(idle);clearTimeout(reconnect);for(const id of streams.keys())endStream(id,false);socket?.terminate();socket=null;publish('disabled');rejectReady(Error('Relay closed'))}}
}
