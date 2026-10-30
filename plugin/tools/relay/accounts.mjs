// Optional relay accounts: who owns which registered computers, so a phone that signs in can
// list them instead of scanning each one. No chat data, Bridge tokens or pairing secrets are stored;
// phones still end-to-end encrypt to each computer and each computer still approves each phone.
import {createHash,randomBytes,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {readFile,rename,rm,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCb);
const hash=x=>createHash('sha256').update(x).digest('base64url');
const fail=(status,code)=>Object.assign(Error(code),{status,code});
const SCRYPT={N:16384,r:8,p:1,maxmem:64*1024*1024};
const SESSION_MS=90*86400000,INVITE_MS=7*86400000,MAX_SESSIONS=50,MAX_COMPUTERS=64;
const USERNAME=/^[a-z0-9][a-z0-9_.-]{2,31}$/,EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():null;

async function passwordHash(password,salt=randomBytes(16)){
 const key=await scrypt(password.normalize('NFKC'),salt,32,SCRYPT);
 return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
async function passwordMatches(password,stored){
 const [kind,salt,key]=stored.split('$');if(kind!=='scrypt')return false;
 const actual=Buffer.from(key,'base64url'),candidate=await scrypt(password.normalize('NFKC'),Buffer.from(salt,'base64url'),actual.length,SCRYPT);
 return timingSafeEqual(actual,candidate);
}
// A fixed hash keeps an unknown login as slow as a wrong password.
const decoy=passwordHash('decoy-password-for-timing');

/**
 * registration: 'invite' (default), 'open' or 'closed' for accounts after the first.
 * The first account (the admin) needs the one-time code this writes to bootstrapFile, readable
 * only on the server, so nobody who reaches the public address first can claim the relay.
 */
export async function createAccounts({file,bootstrapFile,registration='invite',now=()=>Date.now()}){
 if(!['invite','open','closed'].includes(registration))throw Error('registration must be invite, open or closed.');
 let data={version:1,accounts:[],sessions:[],invites:[],computers:[]};
 try{
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved?.version!==1||!['accounts','sessions','invites','computers'].every(key=>Array.isArray(saved[key])))throw Error('Account data is not a version 1 store.');
  data=saved;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 let writing=Promise.resolve();
 async function bootstrap(){
  if(data.accounts.length||!bootstrapFile)return;
  let code=null;
  try{code=(await readFile(bootstrapFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!code||code.length<16){code=randomBytes(18).toString('base64url');await writeFile(bootstrapFile,code+'\n',{mode:0o600});}
  data.invites=data.invites.filter(i=>!i.admin);
  data.invites.push({codeHash:hash(code),admin:true,createdAt:now(),expiresAt:now()+30*86400000});
 }
 // Every change is written whole to a private temporary file, then renamed over the store.
 const save=()=>writing=writing.catch(()=>{}).then(async()=>{const temporary=`${file}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify(data),{mode:0o600});await rename(temporary,file);});
 const prune=()=>{const t=now();data.sessions=data.sessions.filter(s=>s.expiresAt>t);data.invites=data.invites.filter(i=>!i.usedAt&&i.expiresAt>t);};
 await bootstrap();
 const publicAccount=a=>({id:a.id,username:a.username,email:a.email??null,admin:a.admin===true});
 const findLogin=login=>{const value=String(login??'').trim().toLowerCase();return data.accounts.find(a=>a.username===value||(a.email&&a.email===value));};

 async function issue(account,client){
  prune();
  const token=randomBytes(32).toString('base64url'),t=now();
  const mine=data.sessions.filter(s=>s.accountId===account.id).sort((a,b)=>a.createdAt-b.createdAt);
  // The oldest sessions of an account give way instead of growing without bound.
  const drop=new Set(mine.slice(0,Math.max(0,mine.length-MAX_SESSIONS+1)).map(s=>s.tokenHash));
  data.sessions=data.sessions.filter(s=>!drop.has(s.tokenHash));
  data.sessions.push({tokenHash:hash(token),accountId:account.id,client,createdAt:t,expiresAt:t+SESSION_MS});
  await save();
  return {token,expiresAt:t+SESSION_MS,account:publicAccount(account)};
 }
 function authenticate(token){
  if(typeof token!=='string'||token.length<20||token.length>200)return null;
  const tokenHash=hash(token),session=data.sessions.find(s=>s.tokenHash===tokenHash&&s.expiresAt>now());
  const account=session&&data.accounts.find(a=>a.id===session.accountId);
  return account?{account,session}:null;
 }
 const clientOf=value=>value==='computer'?'computer':'phone';

 return {
  get registration(){return registration;},
  authenticate,
  async register({username,email,password,invite,client}){
   const name=String(username??'').trim().toLowerCase(),mail=email==null||email===''?null:String(email).trim().toLowerCase();
   if(!USERNAME.test(name))throw fail(400,'INVALID_USERNAME');
   if(mail!==null&&(!EMAIL.test(mail)||mail.length>254))throw fail(400,'INVALID_EMAIL');
   if(typeof password!=='string'||password.length<8||password.length>256)throw fail(400,'INVALID_PASSWORD');
   prune();
   const first=data.accounts.length===0;
   const ticket=data.invites.find(i=>i.codeHash===hash(String(invite??''))&&(first?i.admin:!i.admin))??null;
   if(first&&!ticket)throw fail(403,'BOOTSTRAP_REQUIRED');
   if(!first&&registration==='closed')throw fail(403,'REGISTRATION_CLOSED');
   if(!first&&registration==='invite'&&!ticket)throw fail(403,'INVITE_REQUIRED');
   if(data.accounts.some(a=>a.username===name||a.email===name||(mail&&(a.email===mail||a.username===mail))))throw fail(409,'ACCOUNT_EXISTS');
   const account={id:randomBytes(12).toString('base64url'),username:name,email:mail,passwordHash:await passwordHash(password),admin:first,createdAt:now()};
   // Checked again after the slow hash: two registrations may have raced for the same name or invite.
   if(data.accounts.some(a=>a.username===name||(mail&&a.email===mail)))throw fail(409,'ACCOUNT_EXISTS');
   if(first&&data.accounts.length)throw fail(403,'BOOTSTRAP_REQUIRED');
   if(ticket){if(ticket.usedAt)throw fail(403,'INVITE_REQUIRED');ticket.usedAt=now();}
   data.accounts.push(account);
   const session=await issue(account,clientOf(client));
   if(first&&bootstrapFile)await rm(bootstrapFile,{force:true});
   return session;
  },
  async login({login,password,client}){
   const account=findLogin(login);
   if(typeof password!=='string'||password.length>256||!account){await passwordMatches(String(password??'').slice(0,256),await decoy);throw fail(401,'INVALID_LOGIN');}
   if(!await passwordMatches(password,account.passwordHash))throw fail(401,'INVALID_LOGIN');
   return issue(account,clientOf(client));
  },
  async logout(token){const tokenHash=hash(String(token??''));const before=data.sessions.length;data.sessions=data.sessions.filter(s=>s.tokenHash!==tokenHash);if(data.sessions.length!==before)await save();},
  async changePassword(account,{password,next}){
   if(typeof next!=='string'||next.length<8||next.length>256)throw fail(400,'INVALID_PASSWORD');
   if(typeof password!=='string'||!await passwordMatches(password,account.passwordHash))throw fail(401,'INVALID_LOGIN');
   account.passwordHash=await passwordHash(next);
   // Every other session of the account ends with the old password.
   data.sessions=data.sessions.filter(s=>s.accountId!==account.id);
   return issue(account,'phone');
  },
  async createInvite(account){
   if(!account.admin)throw fail(403,'ADMIN_REQUIRED');
   prune();
   const code=randomBytes(12).toString('base64url'),t=now();
   data.invites.push({codeHash:hash(code),createdBy:account.id,createdAt:t,expiresAt:t+INVITE_MS});
   await save();
   return {code,expiresAt:t+INVITE_MS};
  },
  /** A computer signed its registration with its own key and presented its owner's session. */
  async bindComputer(account,{id,computerKey,name,serverId}){
   const existing=data.computers.find(c=>c.id===id);
   if(existing&&existing.accountId!==account.id)throw fail(403,'COMPUTER_OWNED');
   if(!existing&&data.computers.filter(c=>c.accountId===account.id).length>=MAX_COMPUTERS)throw fail(429,'COMPUTER_LIMIT');
   const record=existing??{id,accountId:account.id,createdAt:now()};
   Object.assign(record,{computerKey,name:text(name,80)??record.name??null,serverId:text(serverId,128)??record.serverId??null,lastSeenAt:now()});
   if(!existing)data.computers.push(record);
   await save();
   return record;
  },
  computers(account){return data.computers.filter(c=>c.accountId===account.id);},
  async removeComputer(account,id){
   const before=data.computers.length;
   data.computers=data.computers.filter(c=>!(c.accountId===account.id&&c.id===id));
   if(data.computers.length===before)throw fail(404,'NOT_FOUND');
   await save();
  },
  publicAccount,
  flush(){return writing;},
 };
}

/** JSON routes under /v1/account/. Returns false for any other path. */
export function createAccountApi({accounts,origin,online,limit}){
 const failures=new Map();
 const limited=key=>{const t=Date.now(),entry=failures.get(key);if(entry&&entry.expires<t){failures.delete(key);return false;}return (entry?.count??0)>=10;};
 const failed=key=>{const t=Date.now();for(const [k,v] of failures)if(v.expires<t)failures.delete(k);if(failures.size>=8192)return;const entry=failures.get(key)??{count:0,expires:t+15*60000};entry.count++;failures.set(key,entry);};
 const reply=(res,status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));};
 async function body(req){
  if(!String(req.headers['content-type']??'').startsWith('application/json'))throw fail(415,'JSON_REQUIRED');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>16384)throw fail(413,'BODY_TOO_LARGE');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw fail(400,'INVALID_JSON');}
 }
 const bearer=req=>{const value=String(req.headers.authorization??'');return value.startsWith('Bearer ')?value.slice(7):null;};
 const signedIn=req=>{const found=accounts.authenticate(bearer(req));if(!found)throw fail(401,'UNAUTHORIZED');return found;};
 const computerView=c=>({computerId:c.id,computerKey:c.computerKey,serverId:c.serverId,name:c.name,relay:origin,online:online(c.id),lastSeenAt:c.lastSeenAt});
 return async function handle(req,res,ip){
  const url=new URL(req.url,'http://relay.invalid');
  if(!url.pathname.startsWith('/v1/account/'))return false;
  try{
   // Browsers are not clients of this API; refusing them closes cross-site request forgery.
   if(req.headers.origin)throw fail(403,'ORIGIN_DENIED');
   if(!limit(ip))throw fail(429,'RATE_LIMITED');
   const route=`${req.method} ${url.pathname}`;
   if(route==='POST /v1/account/register'||route==='POST /v1/account/login'){
    if(limited(`ip:${ip}`))throw fail(429,'RATE_LIMITED');
    const input=await body(req);
    const key=`login:${String(input.login??input.username??'').trim().toLowerCase()}`;
    if(limited(key))throw fail(429,'RATE_LIMITED');
    try{reply(res,200,route.endsWith('register')?await accounts.register(input):await accounts.login(input));}
    catch(error){if([401,403].includes(error.status)){failed(`ip:${ip}`);failed(key);}throw error;}
    return true;
   }
   if(route==='GET /v1/account/info'){reply(res,200,{registration:accounts.registration,relay:origin});return true;}
   if(route==='POST /v1/account/logout'){await accounts.logout(bearer(req));reply(res,200,{ok:true});return true;}
   const {account}=signedIn(req);
   if(route==='GET /v1/account/me'){reply(res,200,{account:accounts.publicAccount(account)});return true;}
   if(route==='POST /v1/account/password'){reply(res,200,await accounts.changePassword(account,await body(req)));return true;}
   if(route==='POST /v1/account/invites'){reply(res,200,await accounts.createInvite(account));return true;}
   if(route==='GET /v1/account/computers'){reply(res,200,{computers:accounts.computers(account).map(computerView)});return true;}
   const match=/^\/v1\/account\/computers\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
   if(match&&req.method==='DELETE'){await accounts.removeComputer(account,match[1]);reply(res,200,{ok:true});return true;}
   throw fail(404,'NOT_FOUND');
  }catch(error){
   reply(res,error.status??500,{code:error.status?error.code:'INTERNAL'});
   return true;
  }
 };
}
