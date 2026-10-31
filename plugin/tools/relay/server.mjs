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
// These ceilings apply to secret/account registrations too: enabling the public
// door must never create an unbounded pool of connections or encrypted traffic.
export const DEFAULT_LIMITS=Object.freeze({maxConnections:200,connectionsPerIp:20,connectionsPerMinute:600,maxComputers:100,streamsPerComputer:4,registrationPerIpPerHour:30,registrationPerHour:200,bytesPerComputerPerMinute:16*1048576,bytesPerIpPerMinute:32*1048576,bytesPerMinute:256*1048576,framesPerIpPerMinute:6000,framesPerMinute:30000});
function validateLimits(overrides){
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw Error('limits must be an object.');
 for(const [key,value] of Object.entries(overrides))if(!Object.hasOwn(DEFAULT_LIMITS,key)||!Number.isSafeInteger(value)||value<1)throw Error('Every limit must have a supported name and a positive safe integer value.');
 return {...DEFAULT_LIMITS,...overrides};
}
const raw=(s,n)=>{if(typeof s!=='string'||!s||s.length>256)throw Error('invalid');const b=Buffer.from(s,'base64url');if(b.length!==n||b.toString('base64url')!==s)throw Error('invalid');return b;};
// Strict literals only: no zone IDs, CIDRs, ports, lists or alternate IPv4 syntax.
function canonicalIp(value){
 if(typeof value!=='string'||value.includes('%')||!isIP(value))return null;
 if(isIP(value)===4)return value;
 const ip=new URL(`http://[${value}]/`).hostname.slice(1,-1);
 if(/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)){const parts=ip.slice(7).split(':').map(x=>parseInt(x,16));return [parts[0]>>>8,parts[0]&255,parts[1]>>>8,parts[1]&255].join('.');}
 return ip;
}
// Temporary support diagnostics contain only fixed event labels and counters.
// IDs are process-local ordinals, never computer/stream IDs or client addresses.
function createDiagnostics(enabled,write,now){
 const expires=now()+600000;let ended=!enabled,count=0,serial=0,timer;
 const output=(event,fields={})=>{
  try{const result=write(JSON.stringify({component:'relay-diagnostic',at:new Date(now()).toISOString(),event,...fields}));count++;if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{ended=true;clearTimeout(timer);});}
  catch{ended=true;clearTimeout(timer);}
 };
 const stop=reason=>{if(ended)return;ended=true;clearTimeout(timer);output('diagnostics_stopped',{reason});};
 const live=()=>{if(ended)return false;if(now()>=expires){stop('TIME_LIMIT');return false;}if(count>=199){stop('ENTRY_LIMIT');return false;}return true;};
 const event=(trace,name,fields={})=>{if(trace&&live())output(name,{connection:trace.id,role:trace.role,...(trace.computerConnection?{computerConnection:trace.computerConnection}:{}),...fields});};
 if(enabled){output('diagnostics_started',{windowSeconds:600,maxEntries:200});if(!ended){timer=setTimeout(()=>stop('TIME_LIMIT'),600000);timer.unref();}}
 return {
  trace(role){return live()?{id:++serial,role,inBytes:0,inFrames:0,outBytes:0,outFrames:0}:null;},
  event,
  received(trace,data,binary){if(!trace||!live())return;trace.inBytes=Math.min(Number.MAX_SAFE_INTEGER,trace.inBytes+data.length);trace.inFrames++;if(trace.role==='phone'&&trace.inFrames===1)event(trace,'phone_first_frame',{bytes:data.length,binary:binary===true});},
  sent(trace,data){if(!trace||!live())return;trace.outBytes=Math.min(Number.MAX_SAFE_INTEGER,trace.outBytes+Buffer.byteLength(data));trace.outFrames++;if(trace.role==='phone'&&typeof data!=='string'&&!trace.returnedBinary){trace.returnedBinary=true;event(trace,'phone_ciphertext_forwarded',{bytes:data.length});}},
  closed(trace,code){if(trace)event(trace,'connection_closed',{closeCode:Number.isInteger(code)?code:1006,inBytes:trace.inBytes,inFrames:trace.inFrames,outBytes:trace.outBytes,outFrames:trace.outFrames});},
  stop,
 };
}
export async function createRelay({secret,origin,host='127.0.0.1',port=0,allowedOrigins=[],trustProxy=false,trustedProxyIp,accounts=null,openRegistration=false,limits:overrides={},blockedIps=[],blockedComputers=[],diagnostics=false,diagnosticLog=console.log,diagnosticNow=Date.now}){
 const limits=validateLimits(overrides);
 if(typeof diagnostics!=='boolean'||typeof diagnosticLog!=='function'||typeof diagnosticNow!=='function')throw Error('Invalid diagnostic configuration.');
 if(!Array.isArray(blockedIps)||blockedIps.length>4096||blockedIps.some(ip=>!canonicalIp(ip)))throw Error('blockedIps must contain at most 4096 IP literals.');
 if(!Array.isArray(blockedComputers)||blockedComputers.length>4096||blockedComputers.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(id)||Buffer.from(id,'base64url').toString('base64url')!==id))throw Error('blockedComputers must contain at most 4096 computer IDs.');
 const deniedIps=new Set(blockedIps.map(canonicalIp)),deniedComputers=new Set(blockedComputers);
 const configured=trustedProxyIp!==undefined,proxy=configured?canonicalIp(trustedProxyIp):null;
 if(configured&&!proxy)throw Error('trustedProxyIp must be one IP literal.');
 // With accounts, a computer may register with its owner's session instead of the shared secret.
 // With open registration any computer may register: phones still end-to-end encrypt to the
 // computer key from its QR code and each computer still approves each phone.
 if(secret!==undefined||(!accounts&&!openRegistration)){if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw Error('A relay registration secret of at least 32 bytes is required.');}
 const expected=secret===undefined?null:hash(secret),publicUrl=new URL(origin);
 if(publicUrl.protocol!=='wss:'||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash||publicUrl.pathname!=='/')throw Error('A WSS relay origin is required.');
 const diagnostic=createDiagnostics(diagnostics,diagnosticLog,diagnosticNow),traces=new WeakMap();
 const computers=new Map(),rates=new Map(),ips=new Map(),originSet=new Set(allowedOrigins),requests=new Map();
 const registrationIps=new Map(),trafficIps=new Map(),trafficComputers=new Map(),frameIps=new Map();
 let registrations={count:0,expires:0},traffic={count:0,expires:0,frames:0},upgrades={count:0,expires:0};
 // Quota state is bounded even when an attacker creates a new signed identity
 // for every request. Reconnecting a computer does not reset its minute quota.
 const consume=(map,key,amount,maximum,duration)=>{
  const now=Date.now();let item=map.get(key);
  if(!item||item.expires<=now){
   if(!item&&map.size>=4096){for(const [id,value] of map)if(value.expires<=now)map.delete(id);if(map.size>=4096)return false;}
   item={count:0,expires:now+duration};map.set(key,item);
  }
  item.count=Math.min(maximum+1,item.count+amount);return item.count<=maximum;
 };
 const registrationAllowed=ip=>{
  if(!consume(registrationIps,ip,1,limits.registrationPerIpPerHour,3600000))return false;
  const now=Date.now();if(registrations.expires<=now)registrations={count:0,expires:now+3600000};
  registrations.count=Math.min(limits.registrationPerHour+1,registrations.count+1);
  return registrations.count<=limits.registrationPerHour;
 };
 const trafficAllowed=(ip,id,bytes)=>{
  const now=Date.now();if(traffic.expires<=now)traffic={count:0,expires:now+60000,frames:0};
  traffic.count=Math.min(limits.bytesPerMinute+1,traffic.count+bytes);
  traffic.frames=Math.min(limits.framesPerMinute+1,traffic.frames+1);
  return traffic.frames<=limits.framesPerMinute&&consume(frameIps,ip,1,limits.framesPerIpPerMinute,60000)&&traffic.count<=limits.bytesPerMinute&&consume(trafficIps,ip,bytes,limits.bytesPerIpPerMinute,60000)&&(!id||consume(trafficComputers,id,bytes,limits.bytesPerComputerPerMinute,60000));
 };
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
  diagnostic.sent(traces.get(ws),data);ws.send(data);return true;
 };
 const control=(ws,value)=>send(ws,JSON.stringify(value));
 const reject=(socket,status,code)=>socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({code})}`);
 server.on('upgrade',(req,socket,head)=>{
  const trace=diagnostic.trace(req.url.startsWith('/v1/phone')?'phone':req.url.startsWith('/v1/computer')?'computer':'other');
  diagnostic.event(trace,'upgrade_received');
  const refuse=(status,reason)=>{diagnostic.event(trace,'upgrade_rejected',{status,reason});return reject(socket,status,reason);};
  // An explicit address replaces, rather than extends, legacy loopback trust.
  const ip=clientIp(req);
  if(ip===undefined)return refuse(400,'INVALID_CLIENT_IP');
  if(deniedIps.has(ip))return refuse(403,'CLIENT_BLOCKED');
  const now=Date.now();
  if(upgrades.expires<=now)upgrades={count:0,expires:now+60000};
  upgrades.count=Math.min(limits.connectionsPerMinute+1,upgrades.count+1);
  if(upgrades.count>limits.connectionsPerMinute)return refuse(429,'RATE_LIMITED');
  for(const [key,r] of rates)if(r.expires<now)rates.delete(key);
  if(!rates.has(ip)&&rates.size>=4096)return refuse(429,'RATE_LIMITED');
  const rate=rates.get(ip)??{count:0,expires:now+60000};rate.count++;rates.set(ip,rate);
  if(rate.count>60||(ips.get(ip)??0)>=limits.connectionsPerIp||wss.clients.size>=limits.maxConnections)return refuse(429,'RATE_LIMITED');
  if(req.headers.origin&&!originSet.has(req.headers.origin))return refuse(403,'ORIGIN_DENIED');
  let url;
  try{url=new URL(req.url,'http://relay.invalid');}catch{return refuse(400,'INVALID_TARGET');}
  if(!['/v1/computer','/v1/phone'].includes(url.pathname))return refuse(404,'NOT_FOUND');
  if(url.pathname==='/v1/computer'&&url.search)return refuse(400,'INVALID_QUERY');
  const computer=url.pathname==='/v1/phone'?computers.get(url.searchParams.get('computer')):null;
  if(url.pathname==='/v1/phone'&&deniedComputers.has(url.searchParams.get('computer')))return refuse(403,'COMPUTER_BLOCKED');
  if(url.pathname==='/v1/phone'&&(!computer||computer.ws.readyState!==WebSocket.OPEN))return refuse(409,'COMPUTER_OFFLINE');
  if(computer&&computer.streams.size>=limits.streamsPerComputer)return refuse(429,'STREAM_LIMIT');
  wss.handleUpgrade(req,socket,head,ws=>{
   if(trace){trace.role=computer?'phone':'computer';if(computer)trace.computerConnection=traces.get(computer.ws)?.id;traces.set(ws,trace);}
   diagnostic.event(trace,'upgrade_accepted',{status:101});
   ips.set(ip,(ips.get(ip)??0)+1);ws.on('error',()=>{diagnostic.event(trace,'socket_error',{reason:'SOCKET_ERROR'});});ws.lastPong=Date.now();ws.on('pong',()=>{ws.lastPong=Date.now();});
   ws.on('message',(data,binary)=>diagnostic.received(trace,data,binary));
   ws.once('close',code=>diagnostic.closed(trace,code));
   ws.once('close',()=>{const n=(ips.get(ip)??1)-1;if(n)ips.set(ip,n);else ips.delete(ip);});
   if(computer){
    diagnostic.event(trace,'phone_opened');
    const streamId=randomBytes(16),key=streamId.toString('base64url');computer.streams.set(key,ws);
    control(computer.ws,{type:'open',streamId:key});control(ws,{type:'connected',streamId:key});
    ws.on('message',(data,binary)=>{if(!trafficAllowed(ip,computer.id,data.length))return ws.close(4429,'TRAFFIC_LIMIT');if(!binary||data.length>1048576-16)return ws.close(4400,'INVALID_FRAME');send(computer.ws,Buffer.concat([streamId,data]));});
    ws.once('close',()=>{computer.streams.delete(key);control(computer.ws,{type:'close',streamId:key});});
    return;
   }
   const nonce=randomBytes(32).toString('base64url');let registered=null,binding=false,phase='frame';
   const timer=setTimeout(()=>{diagnostic.event(trace,'registration_denied',{closeCode:4408,phase:'timeout'});ws.close(4408,'REGISTRATION_TIMEOUT');},10000);timer.unref();control(ws,{type:'challenge',nonce});
   ws.on('message',(data,binary)=>{
    try{
     if(!trafficAllowed(ip,registered?.id,data.length))return ws.close(4429,'TRAFFIC_LIMIT');
     if(binding)throw Error('invalid');
     if(!registered){
      if(binary||data.length>8192)throw Error('invalid');const m=JSON.parse(data.toString());
      phase='nonce';
      if(m.type!=='register'||m.nonce!==nonce)throw Error('invalid');
      // The shared secret, or (with accounts) the session of the account that owns this computer.
      const owner=typeof m.accountToken==='string'&&accounts?accounts.authenticate(m.accountToken):null;
      phase='credential';
      if(!owner&&!openRegistration&&!(typeof m.secret==='string'&&expected&&timingSafeEqual(hash(m.secret),expected)))throw Error('invalid');
      phase='identity';
      const ed=raw(m.edPublicKey,32);raw(m.computerKey,32);const id=hash(ed).subarray(0,16).toString('base64url');
      if(id!==m.computerId||computers.has(id)||deniedComputers.has(id))throw Error('invalid');
      const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),ed]),format:'der',type:'spki'});
      const signed=JSON.stringify(['ds-bot-computer-v2',origin,nonce,id,m.edPublicKey,m.computerKey]);
      phase='signature';
      if(!verify(null,Buffer.from(signed),key,raw(m.signature,64)))throw Error('invalid');
      if(!registrationAllowed(ip)){diagnostic.event(trace,'registration_denied',{closeCode:4429,phase:'quota'});return ws.close(4429,'REGISTRATION_LIMIT');}
      if(computers.size>=limits.maxComputers){diagnostic.event(trace,'registration_denied',{closeCode:4429,phase:'capacity'});return ws.close(4429,'CAPACITY_LIMIT');}
      const accept=()=>{
       if(ws.readyState!==WebSocket.OPEN||computers.has(id))return ws.close(4403,'REGISTRATION_OR_FRAME_DENIED');
       if(computers.size>=limits.maxComputers)return ws.close(4429,'CAPACITY_LIMIT');
       registered={ws,streams:new Map(),id};computers.set(id,registered);clearTimeout(timer);control(ws,{type:'registered',computerId:id,...(owner?{account:owner.account.username}:{})});
       diagnostic.event(trace,'computer_registered');
      };
      if(!owner)return accept();
      binding=true;
      void accounts.bindComputer(owner.account,{id,computerKey:m.computerKey,name:m.name,serverId:m.serverId})
       .then(()=>{binding=false;accept();},()=>{binding=false;ws.close(4403,'REGISTRATION_OR_FRAME_DENIED');});
      return;
     }
     if(!binary){const m=JSON.parse(data.toString());if(m.type!=='close')throw Error('invalid');const phone=registered.streams.get(raw(m.streamId,16).toString('base64url'));if(phone){diagnostic.event(traces.get(phone),'phone_closed_by_computer',{closeCode:1000});phone.close(1000,'BRIDGE_CLOSED');}return;}
     if(data.length<16)throw Error('invalid');const phone=registered.streams.get(data.subarray(0,16).toString('base64url'));if(!phone)throw Error('invalid');send(phone,data.subarray(16));
    }catch{diagnostic.event(trace,registered?'frame_denied':'registration_denied',{closeCode:4403,phase:registered?'frame':phase});ws.close(4403,'REGISTRATION_OR_FRAME_DENIED');}
   });
   ws.once('close',()=>{clearTimeout(timer);if(registered){if(computers.get(registered.id)===registered)computers.delete(registered.id);for(const phone of registered.streams.values())phone.close(4503,'COMPUTER_OFFLINE');registered.streams.clear();}});
  });
 });
 const heartbeat=setInterval(()=>{const now=Date.now();for(const ws of wss.clients){if(now-ws.lastPong>=30000)ws.terminate();else ws.ping();}},10000);heartbeat.unref();
 server.listen(port,host);await once(server,'listening');let closing;
 return {url:`http://${host.includes(':')?'['+host+']':host}:${server.address().port}`,close(){return closing??=(async()=>{clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));expected?.fill(0);await accounts?.flush();diagnostic.stop('SERVICE_STOPPED');})();}};
}
