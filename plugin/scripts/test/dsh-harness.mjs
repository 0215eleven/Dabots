// Isolated public DSH 0.2.1-rc.2 runs for single-package tests. Everything lives
// under a temporary DSH_HOME; no user profile, network service or credential is used.
import {spawn,execFileSync} from 'node:child_process'
import {createServer} from 'node:net'
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises'
import {join,relative,resolve,sep} from 'node:path'
import {once} from 'node:events'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {fixtureEnvironment} from '../../bridge/test/fixture-environment.mjs'

export const root=resolve(import.meta.dirname,'../../..')
export const deps=join(root,'plugin/bridge/fixture/deps/node_modules')
export const devEngine=join(root,'plugin/bridge/fixture/extended/package')
const delay=ms=>new Promise(r=>setTimeout(r,ms))
export async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p}

export async function createHome(prefix='ds-bot-suite-'){
  const home=await mkdtemp(join(tmpdir(),prefix)),profile=join(home,'profiles/web'),modules=join(profile,'node_modules')
  await mkdir(modules,{recursive:true})
  await symlink(join(deps,'@deepseek-ai'),join(modules,'@deepseek-ai'),'dir')
  await symlink(join(deps,'ws'),join(modules,'ws'),'dir')
  return {home,profile,modules,bridgeHome:join(home,'bridge-home'),dispose:()=>rm(home,{recursive:true,force:true})}
}
export function packDevSuite(out){
  return JSON.parse(execFileSync(process.execPath,[join(root,'plugin/scripts/pack-suite.mjs'),'--dev','--engine',devEngine,'--engine-source','dev: public ds-bot@0.1.7 + repository patch (isolated fixture)','--out',out],{encoding:'utf8'}).trim().split('\n').at(-1))
}
// Replaces node_modules/<name> the way a package manager would.
export async function installDir(modules,name,source){
  await rm(join(modules,name),{recursive:true,force:true})
  await cp(source,join(modules,name),{recursive:true,filter:item=>!relative(source,item).split(sep).some(part=>part==='node_modules'||part==='fixture'||part==='test')})
}
export async function installArchive(modules,name,archive){
  await rm(join(modules,name),{recursive:true,force:true});await mkdir(join(modules,name),{recursive:true})
  execFileSync('tar',['-xzf',archive,'-C',join(modules,name),'--strip-components=1'])
}
export const writeProfile=(env,{dependencies,bundles})=>writeFile(join(env.profile,'package.json'),JSON.stringify({name:'suite-isolated-profile',private:true,dependencies,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app',...bundles]}}},null,2)+'\n')
// The owner's existing Bridge override: by row ID only, in the profile patch layer.
export const writeOwnerPatch=(env,bridgePort,name='Suite test')=>writeFile(join(env.profile,'cordis.patch.yml'),`- id: ds-bot-mobile-bridge\n  config:\n    enabled: true\n    home: ${JSON.stringify(env.bridgeHome)}\n    host: 127.0.0.1\n    port: ${bridgePort}\n    devAllowInsecure: true\n    name: ${name}\n`)

export async function launch(env,{bridgePort}){
  const children=[],shell=await fixtureEnvironment(env.home),webPort=await freePort(),mockPort=await freePort()
  const start=(label,args,extra)=>{const child=spawn(process.execPath,args,{cwd:root,env:{...shell,...extra},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>{output+=c});child.stderr.on('data',c=>{output+=c});children.push({label,child,output:()=>output});return children.at(-1)}
  start('mock-model',[join(root,'plugin/test-support/mock-llm.mjs')],{MOCK_PORT:String(mockPort),MOCK_LOG:join(env.home,`mock-${randomUUID()}.jsonl`),MOCK_DELAY_MS:'50'})
  const dsh=start('dsh',[join(deps,'@deepseek-ai/dsh/lib/bin.js'),'--profile','web','--no-open','--port',String(webPort)],{DEEPSEEK_BASE_URL:`http://127.0.0.1:${mockPort}/v1`,DEEPSEEK_API_KEY:'ds-bot-test-mock-only'})
  const stop=async()=>{for(const {child} of [...children].reverse())if(child.exitCode===null&&child.signalCode===null){const e=once(child,'exit');child.kill('SIGTERM');const t=setTimeout(()=>child.kill('SIGKILL'),5000);await e;clearTimeout(t)}}
  const diagnostics=()=>children.map(item=>`--- ${item.label} exit=${item.child.exitCode}\n${item.output().slice(-4000)}`).join('\n')
  try{
    const bridgeUrl=`http://127.0.0.1:${bridgePort}`
    let info
    for(let i=0;i<900&&!info;i++){
      if(dsh.child.exitCode!==null)throw Error('DSH exited during startup')
      try{const r=await fetch(`${bridgeUrl}/mobile/v1/info`);if(r.ok)info=await r.json();else await delay(100)}catch{await delay(100)}
    }
    if(!info)throw Error('Bridge did not start')
    const token=/\?token=([A-Za-z0-9_-]+)/.exec(dsh.output())?.[1],webBase=`http://127.0.0.1:${webPort}/`
    const login=await fetch(`${webBase}?token=${token}`,{redirect:'manual'}),cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
    const operator=async(method,payload={})=>{
      const rpcId=randomUUID(),response=await fetch(`${webBase}mobile-operator/${method}`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload})})
      if(!response.ok)throw Error(`operator ${method}: HTTP ${response.status}`)
      const body=await response.json();if(body.result?.ok!==true)throw Object.assign(Error(`operator ${method} refused`),{code:body.result?.error?.code});return body.result.value
    }
    const clientScripts=async()=>{
      const html=await (await fetch(webBase,{headers:{cookie}})).text()
      let served='';for(const path of new Set([...html.matchAll(/plugins\/\?\?[^"'\s<>\\]+/g)].map(m=>m[0].replaceAll('&amp;','&'))))served+=await (await fetch(webBase+path,{headers:{cookie}})).text()
      return served
    }
    return {info,bridgeUrl,webBase,cookie,operator,clientScripts,output:()=>dsh.output(),diagnostics,stop}
  }catch(error){console.error(diagnostics());await stop();throw error}
}
