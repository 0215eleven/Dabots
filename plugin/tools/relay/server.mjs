// Opaque BOT relay. Happy-inspired encrypted RPC separation; no plaintext business handlers,
// SDK tokens or public-service defaults. Optional accounts (accounts.mjs) only record which
// registered computers an owner has, so a signed-in phone can list them.
import {createServer} from 'node:http';
import {createHash,createPublicKey,randomBytes,timingSafeEqual,verify} from 'node:crypto';
import {once} from 'node:events';
import {isIP} from 'node:net';
import {WebSocketServer,WebSocket} from 'ws';
import {createAccountApi} from './accounts.mjs';
const hash=x=>createHash('sha256').update(x).digest();
const MAX_COMPUTERS=10000;
const raw=(s,n)=>{if(typeof s!=='string'||!s||s.length>256)throw Error('invalid');const b=Buffer.from(s,'base64url');if(b.length!==n||b.toString('base64url')!==s)throw Error('invalid');return b;};
// Strict literals only: no zone IDs, CIDRs, ports, lists or alternate IPv4 syntax.
function canonicalIp(value){
 if(typeof value!=='string'||value.includes('%')||!isIP(value))return null;
 if(isIP(value)===4)return value;
 const ip=new URL(`http://[${value}]/`).hostname.slice(1,-1);
 if(/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)){const parts=ip.slice(7).split(':').map(x=>parseInt(x,16));return [parts[0]>>>8,parts[0]&255,parts[1]>>>8,parts[1]&255].join('.');}
 return ip;
}
export async function createRelay({secret,origin,host='127.0.0.1',port=0,allowedOrigins=[],trustProxy=false,trustedProxyIp,accounts=null,openRegistration=false}){
 const configured=trustedProxyIp!==undefined,proxy=configured?canonicalIp(trustedProxyIp):null;
 if(configured&&!proxy)throw Error('trustedProxyIp must be one IP literal.');
 // With accounts, a computer may register with its owner's session instead of the shared secret.
 // With open registration any computer may register: phones still end-to-end encrypt to the
 // computer key from its QR code and each computer still approves each phone.
 if(secret!==undefined||(!accounts&&!openRegistration)){if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw Error('A relay registration secret of at least 32 bytes is required.');}
 const expected=secret===undefined?null:hash(secret),publicUrl=new URL(origin);
 if(publicUrl.protocol!=='wss:'||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash||publicUrl.pathname!=='/')throw Error('A WSS relay origin is required.');
 const computers=new Map(),rates=new Map(),ips=new Map(),originSet=new Set(allowedOrigins),requests=new Map();
 // The client address: the peer, or the one X-Real-IP of the trusted proxy. undefined means a malformed header.
 const clientIp=req=>{
  const peer=canonicalIp(req.socket.remoteAddress)??'unknown',forwarded=req.headers['x-real-ip'];
  const trusted=configured?peer===proxy:trustProxy&&['127.0.0.1','::1'].includes(peer);
  if(!trusted||forwarded===undefined)return peer;
  const count=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='x-real-ip').length;
  const ip=canonicalIp(forwarded);
  return count===1&&ip?ip:undefined;
 };
 const allowRequest=ip=>{
  const now=Date.now();
  for(const [key,r] of requests)if(r.expires<now)requests.delete(key);
  if(!requests.has(ip)&&requests.size>=4096)return false;
  const rate=requests.get(ip)??{count:0,expires:now+60000};rate.count++;requests.set(ip,rate);
  return rate.count<=120;
 };
 const accountApi=accounts?createAccountApi({accounts,origin:publicUrl.origin,online:id=>computers.get(id)?.ws.readyState===WebSocket.OPEN,limit:allowRequest}):null;
 const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');
  if(accountApi&&req.url.startsWith('/v1/account/')){
   const ip=clientIp(req);
   if(ip===undefined){res.writeHead(400);res.end('{"code":"INVALID_CLIENT_IP"}');return;}
   if(await accountApi(req,res,ip))return;
  }
  res.writeHead(req.method==='GET'&&req.url==='/healthz'?200:404);res.end(req.url==='/healthz'?'{"ok":true}':'{"code":"NOT_FOUND"}');
 });
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
  const ip=clientIp(req);
  if(ip===undefined)return reject(socket,400,'INVALID_CLIENT_IP');
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
   const nonce=randomBytes(32).toString('base64url');let registered=null,binding=false;
   const timer=setTimeout(()=>ws.close(4408,'REGISTRATION_TIMEOUT'),10000);timer.unref();control(ws,{type:'challenge',nonce});
   ws.on('message',(data,binary)=>{
    try{
     if(binding)throw Error('invalid');
     if(!registered){
      if(binary||data.length>8192)throw Error('invalid');const m=JSON.parse(data.toString());
      if(m.type!=='register'||m.nonce!==nonce)throw Error('invalid');
      // The shared secret, or (with accounts) the session of the account that owns this computer.
      const owner=typeof m.accountToken==='string'&&accounts?accounts.authenticate(m.accountToken):null;
      if(!owner&&!openRegistration&&!(typeof m.secret==='string'&&expected&&timingSafeEqual(hash(m.secret),expected)))throw Error('invalid');
      const ed=raw(m.edPublicKey,32);raw(m.computerKey,32);const id=hash(ed).subarray(0,16).toString('base64url');
      if(id!==m.computerId||computers.has(id)||computers.size>=MAX_COMPUTERS)throw Error('invalid');
      const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),ed]),format:'der',type:'spki'});
      const signed=JSON.stringify(['ds-bot-computer-v2',origin,nonce,id,m.edPublicKey,m.computerKey]);
      if(!verify(null,Buffer.from(signed),key,raw(m.signature,64)))throw Error('invalid');
      const accept=()=>{
       if(ws.readyState!==WebSocket.OPEN||computers.has(id))return ws.close(4403,'REGISTRATION_OR_FRAME_DENIED');
       registered={ws,streams:new Map(),id};computers.set(id,registered);clearTimeout(timer);control(ws,{type:'registered',computerId:id,...(owner?{account:owner.account.username}:{})});
      };
      if(!owner)return accept();
      binding=true;
      void accounts.bindComputer(owner.account,{id,computerKey:m.computerKey,name:m.name,serverId:m.serverId})
       .then(()=>{binding=false;accept();},()=>{binding=false;ws.close(4403,'REGISTRATION_OR_FRAME_DENIED');});
      return;
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
 return {url:`http://${host.includes(':')?'['+host+']':host}:${server.address().port}`,close(){return closing??=(async()=>{clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));expected?.fill(0);await accounts?.flush();})();}};
}
