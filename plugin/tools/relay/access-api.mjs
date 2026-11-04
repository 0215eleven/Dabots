// Phone admission proofs are scoped to one relay and one request/connection.
import {createHash,createPublicKey,verify} from 'node:crypto';
const fail=(status,code)=>Object.assign(Error(code),{status,code});
const digest=value=>createHash('sha256').update(value).digest('hex');
function raw(value,length){
 if(typeof value!=='string'||value.length>128)throw fail(401,'UNAUTHORIZED');
 const bytes=Buffer.from(value,'base64url');
 if(bytes.length!==length||bytes.toString('base64url')!==value)throw fail(401,'UNAUTHORIZED');
 return bytes;
}
export function verifyPhone(key,message,signature){
 try{return verify(null,Buffer.from(message),createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw(key,32)]),format:'der',type:'spki'}),raw(signature,64));}catch{return false;}
}
export const phoneConnectionMessage=({origin,nonce,computerId,computerKey,serverId})=>JSON.stringify(['dabots-phone-connect-v1',origin,nonce,computerId,computerKey,serverId]);
export const phoneRequestMessage=({origin,method,path,time,nonce,body})=>JSON.stringify(['dabots-phone-request-v1',origin,method,path,String(time),nonce,digest(body)]);

export function createAccessApi({access,origin,limit,associate,now=Date.now}){
 const seen=new Map(),failures=new Map(),window=60000;
 const reply=(res,status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));};
 async function read(req){
  if(!String(req.headers['content-type']??'').startsWith('application/json'))throw fail(415,'JSON_REQUIRED');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>4096)throw fail(413,'BODY_TOO_LARGE');chunks.push(chunk);}
  return Buffer.concat(chunks);
 }
 return async(req,res,ip)=>{
  if(!req.url.startsWith('/v1/access/'))return false;
  try{
   const url=new URL(req.url,'http://relay.invalid'),time=now();
   if(url.search||url.pathname!==req.url)throw fail(400,'INVALID_TARGET');
   if(req.headers.origin!==undefined)throw fail(403,'ORIGIN_DENIED');
   for(const [key,value] of failures)if(value.expires<=time)failures.delete(key);
   if(!limit(ip)||(failures.get(ip)?.count??0)>=10)throw fail(429,'RATE_LIMITED');
   const method=req.method,path=url.pathname;
   if(!['GET /v1/access/status','POST /v1/access/redeem','POST /v1/access/associate'].includes(`${method} ${path}`))throw fail(404,'NOT_FOUND');
   const body=method==='POST'?await read(req):Buffer.alloc(0);
   const key=req.headers['x-dabots-phone-key'],stamp=req.headers['x-dabots-time'],nonce=req.headers['x-dabots-nonce'],signature=req.headers['x-dabots-signature'];
   const timestamp=typeof stamp==='string'&&/^\d{13}$/.test(stamp)?Number(stamp):NaN;
   let validNonce=false;try{validNonce=raw(nonce,16).length===16;}catch{}
   if(!Number.isSafeInteger(timestamp)||Math.abs(time-timestamp)>window||!validNonce||!verifyPhone(key,phoneRequestMessage({origin,method,path,time:stamp,nonce,body}),signature))throw fail(401,'UNAUTHORIZED');
   for(const [id,expires] of seen)if(expires<=time)seen.delete(id);
   const replay=`${key}:${nonce}`;
   if(seen.has(replay))throw fail(409,'REPLAYED');
   if(seen.size>=4096)throw fail(429,'RATE_LIMITED');
   seen.set(replay,time+window*2);
   if(method==='GET'){reply(res,200,{protocol:1,enrolled:access.isPhone(key)});return true;}
   let input;try{input=JSON.parse(body.toString('utf8'));if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch{throw fail(400,'INVALID_JSON');}
   if(path.endsWith('/redeem')){
    if(Object.keys(input).length!==1||!Object.hasOwn(input,'code'))throw fail(400,'INVALID_INPUT');
    reply(res,200,await access.redeem(input.code,key));return true;
   }
   if(!access.isPhone(key))throw fail(403,'INVITATION_REQUIRED');
   if(Object.keys(input).length!==4||!['computerId','computerKey','serverId','linkNonce'].every(name=>Object.hasOwn(input,name)))throw fail(400,'INVALID_INPUT');
   await associate(key,input);reply(res,200,{associated:true});return true;
  }catch(error){
   if([401,403].includes(error.status)){
    if(failures.size<4096||failures.has(ip)){const entry=failures.get(ip)??{count:0,expires:now()+15*60000};entry.count++;failures.set(ip,entry);}
   }
   reply(res,error.status??500,{code:error.status?error.code:'INTERNAL'});return true;
  }
 };
}
