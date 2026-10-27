// Opaque, account-free BOT relay. Happy-inspired encrypted RPC separation;
// no plaintext business handlers, database, SDK tokens or public-service defaults.
import {createServer} from 'node:http';
import {createHash,createPublicKey,randomBytes,timingSafeEqual,verify} from 'node:crypto';
import {once} from 'node:events';
import {isIP} from 'node:net';
import {WebSocketServer,WebSocket} from 'ws';
const hash=x=>createHash('sha256').update(x).digest();
const raw=(s,n)=>{if(typeof s!=='string'||!s||s.length>256)throw Error('invalid');const b=Buffer.from(s,'base64url');if(b.length!==n||b.toString('base64url')!==s)throw Error('invalid');return b;};
// Strict literals only: no zone IDs, CIDRs, ports, lists or alternate IPv4 syntax.
function canonicalIp(value){
 if(typeof value!=='string'||value.includes('%')||!isIP(value))return null;
 if(isIP(value)===4)return value;
 const ip=new URL(`http://[${value}]/`).hostname.slice(1,-1);
 if(/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)){const parts=ip.slice(7).split(':').map(x=>parseInt(x,16));return [parts[0]>>>8,parts[0]&255,parts[1]>>>8,parts[1]&255].join('.');}
 return ip;
}
export async function createRelay({secret,origin,host='127.0.0.1',port=0,allowedOrigins=[],trustProxy=false,trustedProxyIp}){
 const configured=trustedProxyIp!==undefined,proxy=configured?canonicalIp(trustedProxyIp):null;
 if(configured&&!proxy)throw Error('trustedProxyIp must be one IP literal.');
 if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw Error('A relay registration secret of at least 32 bytes is required.');
 const expected=hash(secret),publicUrl=new URL(origin);
 if(publicUrl.protocol!=='wss:'||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash||publicUrl.pathname!=='/')throw Error('A WSS relay origin is required.');
 const computers=new Map(),rates=new Map(),ips=new Map(),originSet=new Set(allowedOrigins);
 const server=createServer((req,res)=>{res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');res.writeHead(req.method==='GET'&&req.url==='/healthz'?200:404);res.end(req.url==='/healthz'?'{"ok":true}':'{"code":"NOT_FOUND"}');});
 const wss=new WebSocketServer({noServer:true,maxPayload:1048576,perMessageDeflate:false});
 const send=(ws,data)=>{
  if(ws.readyState!==WebSocket.OPEN)return false;
  let total=0;for(const item of wss.clients)total+=item.bufferedAmount;
  if(ws.bufferedAmount>2*1048576||total>32*1048576){ws.close(4429,'BACKPRESSURE');return false;}
  ws.send(data);return true;
 };
 const control=(ws,value)=>send(ws,JSON.stringify(value));
 const reject=(socket,status,code)=>socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({code})}`);
 server.on('upgrade',(req,socket,head)=>{
  // An explicit address replaces, rather than extends, legacy loopback trust.
  const peer=canonicalIp(req.socket.remoteAddress)??'unknown',forwarded=req.headers['x-real-ip'];
  const trusted=configured?peer===proxy:trustProxy&&['127.0.0.1','::1'].includes(peer);
  let ip=peer;
  if(trusted&&forwarded!==undefined){
   const count=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='x-real-ip').length;
   ip=canonicalIp(forwarded);
   if(count!==1||!ip)return reject(socket,400,'INVALID_CLIENT_IP');
  }
  const now=Date.now();
  for(const [key,r] of rates)if(r.expires<now)rates.delete(key);
  if(!rates.has(ip)&&rates.size>=4096)return reject(socket,429,'RATE_LIMITED');
  const rate=rates.get(ip)??{count:0,expires:now+60000};rate.count++;rates.set(ip,rate);
  if(rate.count>60||(ips.get(ip)??0)>=20)return reject(socket,429,'RATE_LIMITED');
  if(req.headers.origin&&!originSet.has(req.headers.origin))return reject(socket,403,'ORIGIN_DENIED');
  const url=new URL(req.url,'http://relay.invalid');
  if(!['/v1/computer','/v1/phone'].includes(url.pathname))return reject(socket,404,'NOT_FOUND');
  if(url.pathname==='/v1/computer'&&url.search)return reject(socket,400,'INVALID_QUERY');
  const computer=url.pathname==='/v1/phone'?computers.get(url.searchParams.get('computer')):null;
  if(url.pathname==='/v1/phone'&&(!computer||computer.ws.readyState!==WebSocket.OPEN))return reject(socket,409,'COMPUTER_OFFLINE');
  if(computer&&computer.streams.size>=32)return reject(socket,429,'STREAM_LIMIT');
  wss.handleUpgrade(req,socket,head,ws=>{
   ips.set(ip,(ips.get(ip)??0)+1);ws.on('error',()=>{});ws.lastPong=Date.now();ws.on('pong',()=>{ws.lastPong=Date.now();});
   ws.once('close',()=>{const n=(ips.get(ip)??1)-1;if(n)ips.set(ip,n);else ips.delete(ip);});
   if(computer){
    const streamId=randomBytes(16),key=streamId.toString('base64url');computer.streams.set(key,ws);
    control(computer.ws,{type:'open',streamId:key});control(ws,{type:'connected',streamId:key});
    ws.on('message',(data,binary)=>{if(!binary||data.length>1048576-16)return ws.close(4400,'INVALID_FRAME');send(computer.ws,Buffer.concat([streamId,data]));});
    ws.once('close',()=>{computer.streams.delete(key);control(computer.ws,{type:'close',streamId:key});});
    return;
   }
   const nonce=randomBytes(32).toString('base64url');let registered=null;
   const timer=setTimeout(()=>ws.close(4408,'REGISTRATION_TIMEOUT'),10000);timer.unref();control(ws,{type:'challenge',nonce});
   ws.on('message',(data,binary)=>{
    try{
     if(!registered){
      if(binary||data.length>8192)throw Error('invalid');const m=JSON.parse(data.toString());
      if(m.type!=='register'||m.nonce!==nonce||typeof m.secret!=='string'||!timingSafeEqual(hash(m.secret),expected))throw Error('invalid');
      const ed=raw(m.edPublicKey,32);raw(m.computerKey,32);const id=hash(ed).subarray(0,16).toString('base64url');
      if(id!==m.computerId||computers.has(id))throw Error('invalid');
      const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),ed]),format:'der',type:'spki'});
      const signed=JSON.stringify(['ds-bot-computer-v2',origin,nonce,id,m.edPublicKey,m.computerKey]);
      if(!verify(null,Buffer.from(signed),key,raw(m.signature,64)))throw Error('invalid');
      registered={ws,streams:new Map(),id};computers.set(id,registered);clearTimeout(timer);control(ws,{type:'registered',computerId:id});return;
     }
     if(!binary){const m=JSON.parse(data.toString());if(m.type!=='close')throw Error('invalid');const phone=registered.streams.get(raw(m.streamId,16).toString('base64url'));phone?.close(1000,'BRIDGE_CLOSED');return;}
     if(data.length<16)throw Error('invalid');const phone=registered.streams.get(data.subarray(0,16).toString('base64url'));if(!phone)throw Error('invalid');send(phone,data.subarray(16));
    }catch{ws.close(4403,'REGISTRATION_OR_FRAME_DENIED');}
   });
   ws.once('close',()=>{clearTimeout(timer);if(registered){if(computers.get(registered.id)===registered)computers.delete(registered.id);for(const phone of registered.streams.values())phone.close(4503,'COMPUTER_OFFLINE');registered.streams.clear();}});
  });
 });
 const heartbeat=setInterval(()=>{const now=Date.now();for(const ws of wss.clients){if(now-ws.lastPong>=30000)ws.terminate();else ws.ping();}},10000);heartbeat.unref();
 server.listen(port,host);await once(server,'listening');let closing;
 return {url:`http://${host.includes(':')?'['+host+']':host}:${server.address().port}`,close(){return closing??=(async()=>{clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));expected.fill(0);})();}};
}
