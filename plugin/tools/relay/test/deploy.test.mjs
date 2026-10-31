// Executable deployment regressions: fake Docker/systemd/npm, real temporary files and Node imports.
// No production daemon, account, configuration or registry is accessed.
import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,readFile,writeFile,cp,chmod,readdir,stat,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
const helper=join(root,'deploy/update.py')
const ws=join(root,'node_modules/ws')
const files=['bin.mjs','server.mjs','accounts.mjs','package.json','package-lock.json']
const onlyLinux={skip:process.platform!=='linux'?'Linux deployment helper':false}
const fake=`#!/usr/bin/env python3
import json,os,pathlib,subprocess,sys,time
area=pathlib.Path(os.environ['TEST_AREA']);state=json.loads((area/'state.json').read_text());args=sys.argv[1:];name=pathlib.Path(sys.argv[0]).name
with (area/'commands.jsonl').open('a') as log:log.write(json.dumps([name,*args])+'\\n')
def save(): (area/'state.json').write_text(json.dumps(state))
def done(value): print(json.dumps(value) if isinstance(value,(list,dict)) else value);sys.exit(0)
if name=='npm':
 if state['failure']=='npm':sys.exit(7)
 p=pathlib.Path.cwd()/'node_modules';p.mkdir(exist_ok=True);(p/'ws').symlink_to(os.environ['TEST_WS']);sys.exit(0)
if name=='cp':
 if state['failure']=='copy':sys.exit(8)
 os.execv('/bin/cp',['/bin/cp',*args])
if name=='systemctl':
 if args[0]=='cat':done('[Service]')
 if args[0]=='show':done(str(area/'install'))
 if args[0]=='is-active':sys.exit(0)
 if args[0]=='restart':
  if state['failure']=='slow-restart':
   assert not state.get('in_progress'), 'overlapping restarts'
   state['in_progress']=True;save()
   if state['restarts']==0:(area/'restart-entered').write_text('ready');time.sleep(0.5)
   state['in_progress']=False
  state['restarts']+=1;save()
  if state['failure']=='restart-always' or (state['failure']=='restart' and state['restarts']==1):sys.exit(9)
  sys.exit(0)
if name=='docker':
 if args[0]=='image':
  if '{{json .Config.Volumes}}' in args:done({'/app/relay/node_modules':{}} if state['failure']=='image-volume' else {})
  done('sha256:changedimage' if state['failure']=='image-mismatch' else 'sha256:testimage')
 if args[0]=='inspect':
  field=args[2]
  if field=='{{.Image}}':done('sha256:testimage')
  if field=='{{json .State}}':done({'Running':True,'Paused':state['failure']=='paused'})
  if field=='{{.Config.WorkingDir}}':done('/app/relay')
  if field=='{{json .Mounts}}':done([{'Type':'bind','Destination':'/app','Source':state['active']},*([{'Type':'bind','Destination':'/state','Source':str(area/'state')}] if state['failure']!='unmounted-data' else []),*([{'Type':'volume','Destination':'/app/relay','Source':'synthetic-legacy-code'}] if state['failure']=='actual-overlay' else [])])
 if args[0]=='run':
  mount=args[args.index('--mount')+1];directory=mount.split('src=')[1].split(',dst=')[0]
  sys.exit(subprocess.call([os.environ['TEST_NODE'],'-e',args[-1]],cwd=directory))
 if args[0]=='compose':
  config=pathlib.Path(args[args.index('-f')+1]);op=args[args.index('-f')+2]
  if op=='config':
   if state['failure']=='config' and config.name.startswith('.compose-check'):sys.exit(10)
   sys.exit(0)
  if op=='ps':done('synthetic-relay-id')
  if op=='exec':
   script=args[-1]
   if 'dataFile:' in script:done({'dataFile':'/app/relay/accounts.json' if state['failure']=='data-in-app' else '/state/accounts.json'})
   if state['failure']=='health' and state['restarts']==1:sys.exit(11)
   sys.exit(0)
  if op=='up':
   assert args[-1]=='relay' and '--no-deps' in args and '--no-build' in args and '--force-recreate' in args
   assert args[-3:-1]==['--pull','never']
   if state['failure']=='slow-restart':
    assert not state.get('in_progress'), 'overlapping restarts'
    state['in_progress']=True;save()
    if state['restarts']==0:(area/'restart-entered').write_text('ready');time.sleep(0.5)
    state['in_progress']=False
   state['restarts']+=1
   if state['failure']=='restart-always' or (state['failure']=='restart' and state['restarts']==1):save();sys.exit(9)
   if not (state['failure']=='stale-mount' and state['restarts']==1):
    value=json.loads(config.read_text())['services']['relay']['volumes'][0]
    state['active']=value['source'] if isinstance(value,dict) else value.split(':')[0]
   save();sys.exit(0)
sys.exit(99)
`

async function fixture(t,{mode='compose',failure='',longMount=false}={}){
 const area=await mkdtemp(join(tmpdir(),'relay-deploy-'))
 t.after(()=>rm(area,{recursive:true,force:true}))
 const install=join(area,'install'),previous=join(area,'releases/748f671'),bin=join(area,'tools')
 await Promise.all([mkdir(install),mkdir(join(previous,'relay'),{recursive:true}),mkdir(bin)])
 for(const dir of [install,join(previous,'relay')]){
  for(const name of files)if(name!=='accounts.mjs'){
   await writeFile(join(dir,name),`old ${name}\n`,{mode:0o640});await chmod(join(dir,name),0o640)
  }
  await mkdir(join(dir,'node_modules'));await writeFile(join(dir,'node_modules','old-dependency'),'old\n')
  await writeFile(join(dir,'accounts.json'),'runtime data version 1\n',{mode:0o600})
 }
 await writeFile(join(area,'start-relay.sh'),'original startup\n',{mode:0o700})
 await writeFile(join(area,'rollback.py'),'original rollback\n',{mode:0o700})
 await writeFile(join(area,'secret'),'synthetic-registration-secret-that-must-not-be-printed',{mode:0o600})
 const definition={image:'node:24-alpine',container_name:'ds-bot-relay',working_dir:'/app/relay',command:['node','bin.mjs'],restart:'unless-stopped',
  environment:{RELAY_SECRET_FILE:'/run/secrets/relay',RELAY_DATA_FILE:'/state/accounts.json'},
  volumes:[longMount?{type:'bind',source:previous,target:'/app',read_only:true}:`${previous}:/app:ro`,`${area}/secret:/run/secrets/relay:ro`,`${area}/state:/state`],networks:['existing-private']}
 const config={name:'existing-project',services:{relay:definition,caddy:{image:'caddy:2-alpine'},tetris:{image:'game:original'},hot:{image:'old:paused',profiles:['paused']}},networks:{'existing-private':{external:true}}}
 const original=JSON.stringify(config,null,4)+'\n'
 await writeFile(join(area,'compose.json'),original,{mode:0o640})
 await chmod(join(area,'compose.json'),0o640)
 await writeFile(join(area,'state.json'),JSON.stringify({failure,restarts:0,active:previous}))
 await writeFile(join(area,'commands.jsonl'),'')
 for(const name of ['docker','systemctl','npm','cp'])await writeFile(join(bin,name),fake,{mode:0o755})
 const env={...process.env,PATH:bin+':'+process.env.PATH,TEST_AREA:area,TEST_WS:ws,TEST_NODE:process.execPath}
 let url
 if(mode==='systemd'){
  const server=createServer(async(_req,res)=>{
   const state=JSON.parse(await readFile(join(area,'state.json'),'utf8'))
   // Runtime state may advance while the candidate runs; rollback must not replace it.
   if(state.restarts===1)await writeFile(join(install,'accounts.json'),'runtime data version 2\n',{mode:0o600})
   res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:!(failure==='health'&&state.restarts===1)}))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  url=`http://127.0.0.1:${server.address().port}/healthz`
 }
 async function execute(extra=[],injection='',withService=true){
  const bootstrap=`import importlib.util,os,sys\nspec=importlib.util.spec_from_file_location('relay_update',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nm.os.geteuid=lambda:0\n${injection}\nsys.exit(m.main(sys.argv[2:]))`
  const args=['-c',bootstrap,helper,'--mode',mode,...(withService?['--service',mode==='compose'?'relay':'ds-bot-relay']:[]),'--health-attempts','1',...(mode==='compose'?['--compose',join(area,'compose.json')]:['--health-url',url]),...extra]
  const child=spawn('python3',args,{env,stdio:['ignore','pipe','pipe']})
  let output='';child.stdout.on('data',c=>{output+=c});child.stderr.on('data',c=>{output+=c})
  const [code]=await once(child,'exit')
  assert.equal(output.includes('synthetic-registration-secret'),false)
  return {code,output}
 }
 const commands=async()=>{try{return(await readFile(join(area,'commands.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}catch{return[]}}
 const unchanged=async()=>{
  assert.equal(await readFile(join(area,'start-relay.sh'),'utf8'),'original startup\n')
  assert.equal(await readFile(join(area,'rollback.py'),'utf8'),'original rollback\n')
  assert.equal(await readFile(join(area,'secret'),'utf8'),'synthetic-registration-secret-that-must-not-be-printed')
  assert.equal((await stat(join(area,'secret'))).mode&0o777,0o600)
  assert.equal((await stat(join(area,'compose.json'))).mode&0o777,0o640)
 }
 return {area,install,previous,original,config,execute,commands,unchanged,env}
}

for(const longMount of [false,true])test(`Compose updates only Relay, preserving ${longMount?'long':'short'} mount options, settings and other services`,onlyLinux,async t=>{
 const f=await fixture(t,{longMount});const result=await f.execute();assert.equal(result.code,0,result.output)
 const updated=JSON.parse(await readFile(join(f.area,'compose.json'),'utf8'))
 const value=updated.services.relay.volumes[0]
 const release=longMount?value.source:value.split(':')[0]
 assert.notEqual(release,f.previous)
 updated.services.relay.volumes[0]=f.config.services.relay.volumes[0]
 assert.deepEqual(updated,f.config)
 assert.equal(await readFile(join(release,'relay','server.mjs'),'utf8'),await readFile(join(root,'server.mjs'),'utf8'))
 assert.equal(await readFile(join(f.previous,'relay','server.mjs'),'utf8'),'old server.mjs\n')
 const calls=await f.commands();const updates=calls.filter(c=>c[0]==='docker'&&c.includes('up'))
 assert.equal(updates.length,1);assert.equal(updates[0].at(-1),'relay');assert.ok(updates[0].includes('--no-deps'))
 assert.equal(calls.some(c=>c.includes('down')||c.includes('daemon-reload')||c.includes('enable')),false)
 await f.unchanged()
})

for(const failure of ['npm','copy','config','restart','health','stale-mount','restart-always'])test(`Compose ${failure} failure preserves/restores original bytes and only restarts Relay`,onlyLinux,async t=>{
 const f=await fixture(t,{failure});const result=await f.execute();assert.equal(result.code,1,result.output)
 assert.equal(await readFile(join(f.area,'compose.json'),'utf8'),f.original)
 const state=JSON.parse(await readFile(join(f.area,'state.json'),'utf8'))
 if(['npm','copy','config'].includes(failure))assert.equal(state.restarts,0)
 else assert.equal(state.restarts,2)
 if(failure==='restart-always')assert.match(result.output,/could not be confirmed/)
 else if(['restart','health','stale-mount'].includes(failure))assert.match(result.output,/release restored/)
 await f.unchanged()
})

test('Compose rejects mutable data in the release and unsupported mount layouts before staging',onlyLinux,async t=>{
 const f=await fixture(t,{failure:'data-in-app'});let result=await f.execute();assert.equal(result.code,1);assert.match(result.output,/Mutable Relay data/)
 let dirs=await readdir(f.area);assert.equal(dirs.some(d=>d.startsWith('.relay-update-')),false)
 f.config.services.relay.working_dir='/different';await writeFile(join(f.area,'compose.json'),JSON.stringify(f.config))
 result=await f.execute();assert.equal(result.code,1);assert.match(result.output,/Unknown Compose|Expected an existing/)
 dirs=await readdir(f.area);assert.equal(dirs.some(d=>d.startsWith('.relay-update-')),false)
})

for(const failure of ['unmounted-data','image-mismatch','paused'])test(`Compose ${failure} preflight refuses without staging or restart`,onlyLinux,async t=>{
 const f=await fixture(t,{failure});const result=await f.execute();assert.equal(result.code,1,result.output)
 assert.equal(await readFile(join(f.area,'compose.json'),'utf8'),f.original)
 assert.equal((await readdir(f.area)).some(d=>d.startsWith('.relay-update-')),false)
 assert.equal((await f.commands()).some(c=>c.includes('up')||c[1]==='run'),false)
})

for(const failure of ['actual-overlay','image-volume','volumes-from','directory-overlay','file-overlay','dependency-overlay','tmpfs-overlay'])test(`Compose ${failure} cannot hide old code behind a healthy /app mount`,onlyLinux,async t=>{
 const f=await fixture(t,{failure})
 if(failure==='volumes-from')f.config.services.relay.volumes_from=['legacy:ro']
 if(failure==='directory-overlay')f.config.services.relay.volumes.push(`${f.area}/legacy:/app/relay:ro`)
 if(failure==='file-overlay')f.config.services.relay.volumes.push({type:'bind',source:join(f.area,'old-server.mjs'),target:'/app/relay/server.mjs',read_only:true})
 if(failure==='dependency-overlay')f.config.services.relay.volumes.push('/app/relay/node_modules')
 if(failure==='tmpfs-overlay')f.config.services.relay.tmpfs=['/app/relay/cache:rw']
 const original=JSON.stringify(f.config);await writeFile(join(f.area,'compose.json'),original)
 const result=await f.execute();assert.equal(result.code,1,result.output);assert.match(result.output,/nested mount|volumes_from/)
 assert.equal(await readFile(join(f.area,'compose.json'),'utf8'),original)
 assert.equal((await readdir(f.area)).some(d=>d.startsWith('.relay-update-')),false)
 assert.equal((await f.commands()).some(c=>c.includes('up')||c[1]==='run'),false)
})

test('runtime data discovery resolves relative paths and existing symlink ancestors',onlyLinux,async t=>{
 const area=await mkdtemp(join(tmpdir(),'relay-data-path-'));t.after(()=>rm(area,{recursive:true,force:true}))
 const cwd=join(area,'app/relay'),persistent=join(area,'persistent');await mkdir(cwd,{recursive:true});await mkdir(persistent)
 await symlink(persistent,join(cwd,'linked'))
 const script=await new Promise((resolve,reject)=>{
  const child=spawn('python3',['-c',"import importlib.util,sys\ns=importlib.util.spec_from_file_location('u',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.RUNTIME)",helper])
  let output='';child.stdout.on('data',c=>{output+=c});child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error('runtime script read failed')))
 })
 for(const [path,expected]of [['data/accounts.json',join(cwd,'data/accounts.json')],['linked/accounts.json',join(persistent,'accounts.json')]]){
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['-e',script],{cwd,env:{PATH:process.env.PATH,RELAY_DATA_FILE:path}})
   let output='';child.stdout.on('data',c=>{output+=c});child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(Error('runtime discovery failed')))
  })
  assert.equal(result.dataFile,expected)
 }
})

test('Compose --check changes no files or services and a concurrent update is refused',onlyLinux,async t=>{
 const f=await fixture(t);const before=await readdir(f.area);const result=await f.execute(['--check']);assert.equal(result.code,0,result.output)
 assert.deepEqual(await readdir(f.area),before)
 assert.equal((await f.commands()).some(c=>c.includes('up')||c[1]==='run'),false)
 const holder=spawn('python3',['-c',`import fcntl,sys\nf=open(sys.argv[1],'w');fcntl.flock(f,fcntl.LOCK_EX);print('locked',flush=True);sys.stdin.read()`,join(f.area,'.relay-update.lock')],{stdio:['pipe','pipe','pipe']})
 t.after(()=>holder.kill());await once(holder.stdout,'data')
 const locked=await f.execute();assert.equal(locked.code,1);assert.match(locked.output,/Another Relay update/)
 assert.equal(await readFile(join(f.area,'compose.json'),'utf8'),f.original)
 assert.equal((await readdir(f.area)).some(d=>d.startsWith('.relay-update-')),false)
 holder.stdin.end();await once(holder,'exit')
})

for(const failure of ['', 'npm','restart','health','restart-always','file-copy'])test(`systemd ${failure||'success'} preserves configuration/data and restores code when needed`,onlyLinux,async t=>{
 const f=await fixture(t,{mode:'systemd',failure})
 const injection=failure==='file-copy'?`original=m.copy_file\nfailed=False\ndef copy(source,target,metadata=None):\n global failed\n if not failed and target.name.startswith('.server.mjs.update-'):\n  failed=True\n  raise OSError('injected candidate copy failure')\n return original(source,target,metadata)\nm.copy_file=copy`:''
 const result=await f.execute([],injection);assert.equal(result.code,failure?1:0,result.output)
 const state=JSON.parse(await readFile(join(f.area,'state.json'),'utf8'))
 assert.equal(await readFile(join(f.install,'server.mjs'),'utf8'),failure?'old server.mjs\n':await readFile(join(root,'server.mjs'),'utf8'))
 assert.equal((await stat(join(f.install,'server.mjs'))).mode&0o777,0o640)
 if(failure==='npm')assert.equal(state.restarts,0)
 else if(failure)assert.equal(state.restarts,failure==='file-copy'?1:2)
 else assert.equal(state.restarts,1)
 if(failure==='restart-always')assert.match(result.output,/could not be confirmed/)
 if(failure==='health')assert.equal(await readFile(join(f.install,'accounts.json'),'utf8'),'runtime data version 2\n')
 if(failure)assert.equal(await readFile(join(f.install,'node_modules/old-dependency'),'utf8'),'old\n')
 assert.equal((await f.commands()).some(c=>c.includes('daemon-reload')||c.includes('enable')),false)
 await f.unchanged()
})

for(const mode of ['compose','systemd'])test(`${mode} terminal interruption rolls back and repeated recovery signals are ignored`,onlyLinux,async t=>{
 const f=await fixture(t,{mode})
 const kind=mode==='compose'?'Compose':'Systemd'
 const injection=`import signal\noriginal=m.${kind}.restart\nfirst=True\ndef restart(self):\n global first\n if first:\n  first=False\n  os.kill(os.getpid(),signal.SIGTERM)\n else:\n  os.kill(os.getpid(),signal.SIGINT)\n  os.kill(os.getpid(),signal.SIGHUP)\n  return original(self)\nm.${kind}.restart=restart`
 const result=await f.execute([],injection);assert.equal(result.code,1,result.output);assert.match(result.output,/restored/)
 assert.equal(await readFile(join(f.area,'compose.json'),'utf8'),f.original)
 assert.equal(await readFile(join(f.install,'server.mjs'),'utf8'),'old server.mjs\n')
 const state=JSON.parse(await readFile(join(f.area,'state.json'),'utf8'));assert.equal(state.restarts,1)
 await f.unchanged()
})

for(const mode of ['compose','systemd'])test(`${mode} waits for an in-progress restart before signal recovery`,onlyLinux,async t=>{
 const f=await fixture(t,{mode,failure:'slow-restart'});const kind=mode==='compose'?'Compose':'Systemd'
 const injection=`import signal,threading,time,pathlib\noriginal=m.${kind}.restart\nfirst=True\ndef restart(self):\n global first\n if first:\n  first=False\n  def interrupt():\n   marker=pathlib.Path(os.environ['TEST_AREA'])/'restart-entered'\n   while not marker.exists():time.sleep(0.01)\n   os.kill(os.getpid(),signal.SIGTERM)\n  threading.Thread(target=interrupt,daemon=True).start()\n return original(self)\nm.${kind}.restart=restart`
 const result=await f.execute([],injection);assert.equal(result.code,1,result.output);assert.match(result.output,/restored/)
 const state=JSON.parse(await readFile(join(f.area,'state.json'),'utf8'));assert.equal(state.restarts,2);assert.equal(state.in_progress,false)
 assert.equal(await readFile(join(f.area,'compose.json'),'utf8'),f.original)
 assert.equal(await readFile(join(f.install,'server.mjs'),'utf8'),'old server.mjs\n')
 await f.unchanged()
})

test('systemd retains RELAY_SERVICE compatibility and explicit service takes precedence',onlyLinux,async t=>{
 const f=await fixture(t,{mode:'systemd'});f.env.RELAY_SERVICE='legacy-relay'
 let result=await f.execute(['--check'],'',false);assert.equal(result.code,0,result.output);assert.match(result.output,/service legacy-relay/)
 result=await f.execute(['--check']);assert.equal(result.code,0,result.output);assert.match(result.output,/service ds-bot-relay/)
 const c=await fixture(t);c.env.RELAY_SERVICE='legacy-relay'
 result=await c.execute(['--check'],'',false);assert.equal(result.code,1,result.output);assert.match(result.output,/use --service explicitly/)
 assert.equal((await c.commands()).length,0)
})

for(const accounts of [false,true])test(`documented clean install starts with accounts ${accounts?'enabled':'disabled'}`,onlyLinux,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'relay-documented-install-'));t.after(()=>rm(directory,{recursive:true,force:true}))
 const doc=await readFile(join(root,'DEPLOYMENT.md'),'utf8')
 const match=doc.match(/sudo cp ([^\n]+) \/opt\/ds-bot-relay\//);assert.ok(match,'documented copy command')
 const documented=match[1].split(/\s+/);assert.deepEqual(documented,[...files])
 for(const name of documented)await cp(join(root,name),join(directory,name))
 // Materialize the exact locked dependency already installed by root setup, without using a registry.
 await mkdir(join(directory,'node_modules'));await cp(ws,join(directory,'node_modules/ws'),{recursive:true})
 await writeFile(join(directory,'secret'),'isolated-document-install-secret-32-bytes',{mode:0o600})
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r))
 const env={PATH:process.env.PATH,RELAY_ORIGIN:'wss://install.example',RELAY_HOST:'127.0.0.1',RELAY_PORT:String(port),...(accounts?{RELAY_DATA_FILE:join(directory,'accounts.json')}:{RELAY_SECRET_FILE:join(directory,'secret')})}
 const child=spawn(process.execPath,[join(directory,'bin.mjs')],{env,stdio:['ignore','pipe','pipe']});t.after(()=>child.exitCode===null&&child.kill())
 let output='';child.stdout.on('data',c=>{output+=c});child.stderr.on('data',c=>{output+=c})
 for(let i=0;i<100&&!output.includes('listening')&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,20))
 assert.match(output,/listening/);assert.deepEqual(await(await fetch(`http://127.0.0.1:${port}/healthz`)).json(),{ok:true})
 child.kill('SIGTERM');assert.equal((await once(child,'exit'))[0],0)
})
