// Optional computer approval for the relay. With it on, only approved computers may register; a
// new computer is recorded as pending until an admin approves it. Admins are phones holding an
// Ed25519 key: every admin request is signed, so the relay stores public keys only. The first
// admin claims the relay with a one-time code written to a file only the server can read.
import {createHash,createPublicKey,randomBytes,verify} from 'node:crypto';
import {readFile,rename,rm,writeFile} from 'node:fs/promises';
const fail=(status,code)=>Object.assign(Error(code),{status,code});
const hash=value=>createHash('sha256').update(value).digest('hex');
const ID=/^[A-Za-z0-9_-]{22}$/,KEY=/^[A-Za-z0-9_-]{43}$/,SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const MAX_PENDING=500,PENDING_MS=7*86400000,SKEW_MS=5*60000,MAX_ADMINS=8;
const label=value=>typeof value==='string'&&value.trim()&&value.length<=64&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():null;
const rawKey=value=>{const bytes=Buffer.from(value,'base64url');if(bytes.length!==32||bytes.toString('base64url')!==value)throw fail(401,'UNAUTHORIZED');return createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),bytes]),format:'der',type:'spki'});};

export async function createApprovals({file,bootstrapFile,now=()=>Date.now()}){
 let data={version:1,admins:[],approved:[],pending:[],denied:[]};
 try{
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved?.version!==1||!['admins','approved','pending','denied'].every(key=>Array.isArray(saved[key])))throw Error('Approval data is not a version 1 store.');
  data=saved;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 let writing=Promise.resolve();
 const save=()=>writing=writing.catch(()=>{}).then(async()=>{const temporary=`${file}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify(data),{mode:0o600});await rename(temporary,file);});
 let bootstrapHash=null;
 if(!data.admins.length&&bootstrapFile){
  let code=null;
  try{code=(await readFile(bootstrapFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!code||code.length<16){code=randomBytes(15).toString('base64url');await writeFile(bootstrapFile,code+'\n',{mode:0o600});}
  bootstrapHash=hash(code);
 }
 const prune=()=>{const t=now();data.pending=data.pending.filter(item=>item.lastSeenAt>t-PENDING_MS);};
 const view=item=>({computerId:item.id,name:item.name??null,...(item.firstSeenAt?{firstSeenAt:item.firstSeenAt,lastSeenAt:item.lastSeenAt}:{}),...(item.approvedAt?{approvedAt:item.approvedAt}:{})});
 return {
  isApproved:id=>data.approved.some(item=>item.id===id),
  isAdmin:key=>data.admins.some(item=>item.key===key),
  hasAdmin:()=>data.admins.length>0,
  /** A computer that registered without approval; denied computers are not listed again. */
  async notePending(id,name){
   if(data.denied.includes(id)||data.approved.some(item=>item.id===id))return;
   prune();
   const t=now(),item=data.pending.find(entry=>entry.id===id);
   if(item){item.lastSeenAt=t;item.name=label(name)??item.name??null;}
   else{if(data.pending.length>=MAX_PENDING)data.pending.sort((a,b)=>a.lastSeenAt-b.lastSeenAt).shift();data.pending.push({id,name:label(name),firstSeenAt:t,lastSeenAt:t});}
   await save();
  },
  list(){prune();return {pending:data.pending.map(view).sort((a,b)=>b.lastSeenAt-a.lastSeenAt),approved:data.approved.map(view)};},
  async approve(id){
   if(!ID.test(String(id)))throw fail(400,'INVALID_COMPUTER');
   const pending=data.pending.find(item=>item.id===id);
   data.pending=data.pending.filter(item=>item.id!==id);data.denied=data.denied.filter(item=>item!==id);
   if(!data.approved.some(item=>item.id===id))data.approved.push({id,name:pending?.name??null,approvedAt:now()});
   await save();
  },
  async deny(id){
   if(!ID.test(String(id)))throw fail(400,'INVALID_COMPUTER');
   data.pending=data.pending.filter(item=>item.id!==id);data.approved=data.approved.filter(item=>item.id!==id);
   if(!data.denied.includes(id))data.denied=[...data.denied.slice(-(MAX_PENDING-1)),id];
   await save();
  },
  async revoke(id){
   if(!ID.test(String(id)))throw fail(400,'INVALID_COMPUTER');
   data.approved=data.approved.filter(item=>item.id!==id);
   await save();
  },
  /** The first admin key, with the server-side one-time code. */
  async claim(code,key){
   if(!bootstrapHash||data.admins.length)throw fail(403,'ADMIN_EXISTS');
   if(typeof code!=='string'||hash(code.trim())!==bootstrapHash)throw fail(403,'INVALID_CODE');
   data.admins.push({key,addedAt:now()});bootstrapHash=null;
   await save();
   if(bootstrapFile)await rm(bootstrapFile,{force:true});
  },
  async addAdmin(key){if(!KEY.test(key))throw fail(400,'INVALID_KEY');if(data.admins.length>=MAX_ADMINS)throw fail(429,'ADMIN_LIMIT');if(!data.admins.some(item=>item.key===key))data.admins.push({key,addedAt:now()});await save();},
  flush(){return writing;},
 };
}

/** The exact bytes an admin phone signs for one request. */
export function adminMessage({origin,method,path,time,body}){
 return JSON.stringify(['dabots-relay-admin-v1',origin,method,path,String(time),createHash('sha256').update(body).digest('hex')]);
}

/** Signed JSON routes under /v1/admin/. Returns false for any other path. */
export function createAdminApi({approvals,origin,limit,onApprove=()=>{},onRevoke=()=>{},now=()=>Date.now()}){
 const seen=new Map(),failures=new Map();
 const reply=(res,status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));};
 async function read(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4096)throw fail(413,'BODY_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks);}
 function authenticate(req,path,body){
  const key=String(req.headers['x-dabots-admin-key']??''),time=Number(req.headers['x-dabots-admin-time']),signature=String(req.headers['x-dabots-admin-signature']??'');
  if(!KEY.test(key)||!SIGNATURE.test(signature)||!Number.isSafeInteger(time)||Math.abs(now()-time)>SKEW_MS)throw fail(401,'UNAUTHORIZED');
  const message=adminMessage({origin,method:req.method,path,time,body});
  if(!verify(null,Buffer.from(message),rawKey(key),Buffer.from(signature,'base64url')))throw fail(401,'UNAUTHORIZED');
  // A signed request is accepted once.
  const t=now();for(const [id,expires] of seen)if(expires<t)seen.delete(id);
  if(seen.has(signature)||seen.size>=4096)throw fail(409,'REPLAYED');
  seen.set(signature,t+2*SKEW_MS);
  return key;
 }
 const tooMany=ip=>{const t=now(),entry=failures.get(ip);if(entry&&entry.expires<t){failures.delete(ip);return false;}return (entry?.count??0)>=10;};
 const failed=ip=>{const t=now();if(failures.size>=4096)return;const entry=failures.get(ip)??{count:0,expires:t+15*60000};entry.count++;failures.set(ip,entry);};
 return async function handle(req,res,ip){
  const url=new URL(req.url,'http://relay.invalid');
  if(!url.pathname.startsWith('/v1/admin/'))return false;
  try{
   if(!limit(ip)||tooMany(ip))throw fail(429,'RATE_LIMITED');
   const body=req.method==='POST'?await read(req):Buffer.alloc(0);
   let key;
   try{key=authenticate(req,url.pathname,body);}catch(error){failed(ip);throw error;}
   const input=body.length?(()=>{try{const value=JSON.parse(body.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw fail(400,'INVALID_JSON');}})():{};
   const route=`${req.method} ${url.pathname}`;
   if(route==='POST /v1/admin/claim'){try{await approvals.claim(input.code,key);}catch(error){failed(ip);throw error;}reply(res,200,{admin:true});return true;}
   if(route==='GET /v1/admin/status'){reply(res,200,{admin:approvals.isAdmin(key),claimable:!approvals.hasAdmin()});return true;}
   if(!approvals.isAdmin(key))throw fail(403,'ADMIN_REQUIRED');
   if(route==='GET /v1/admin/devices'){reply(res,200,approvals.list());return true;}
   if(route==='POST /v1/admin/approve'){await approvals.approve(input.computerId);onApprove(input.computerId);reply(res,200,{ok:true});return true;}
   if(route==='POST /v1/admin/deny'){await approvals.deny(input.computerId);onRevoke(input.computerId);reply(res,200,{ok:true});return true;}
   if(route==='POST /v1/admin/revoke'){await approvals.revoke(input.computerId);onRevoke(input.computerId);reply(res,200,{ok:true});return true;}
   throw fail(404,'NOT_FOUND');
  }catch(error){reply(res,error.status??500,{code:error.status?error.code:'INTERNAL'});return true;}
 };
}
