// Moves a DSH profile from the separate ds-bot / ds-bot-mobile-bridge /
// ds-bot-mobile-app bundles to the single ds-bot package, and back.
//   node scripts/migrate-suite.mjs plan     --dsh-home <dir> --profile <name>
//   node scripts/migrate-suite.mjs backup   --dsh-home <dir> --profile <name> --to <new dir>
//   node scripts/migrate-suite.mjs deselect --dsh-home <dir> --profile <name> --backup <dir> --dsh-stopped
//   (install the single package with the DSH plugin manager)
//   node scripts/migrate-suite.mjs verify   --dsh-home <dir> --profile <name> --backup <dir>
//   node scripts/migrate-suite.mjs rollback --dsh-home <dir> --profile <name> --backup <dir> --dsh-stopped [--bridge-home]
// Old packages are never uninstalled and dsh-plugin-mobile-gateway is never
// touched. Nothing prints tokens or token hashes; backups hold Bridge
// credentials and are written owner-only.
import {createHash,randomUUID} from 'node:crypto'
import {cp,mkdir,readFile,readdir,rename,stat,writeFile} from 'node:fs/promises'
import {isAbsolute,join,resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'

export const OLD_BUNDLES=['ds-bot-mobile-bridge','ds-bot-mobile-app']
export const GATEWAY='dsh-plugin-mobile-gateway'
const BRIDGE_ROW='ds-bot-mobile-bridge'
const PROFILE_FILES=['package.json','pnpm-lock.yaml','cordis.patch.yml']
const sha=text=>createHash('sha256').update(text).digest('hex')
const readOptional=async path=>{try{return await readFile(path,'utf8')}catch(error){if(error.code==='ENOENT')return undefined;throw error}}
async function writeAtomic(path,text){const temporary=`${path}.${randomUUID()}.tmp`;await writeFile(temporary,text,{mode:0o600});await rename(temporary,path)}

// Line-based reading of the owner's patch layers: enough to find the Bridge row
// override and its home without a YAML dependency. Patch files are never rewritten.
export function bridgeOverrides(text=''){
  const lines=text.split(/\r?\n/),found=[]
  for(let i=0;i<lines.length;i++){
    const head=/^(\s*)-\s*id:\s*['"]?([^'"\s#]+)['"]?\s*(#.*)?$/.exec(lines[i])
    if(!head||head[2]!==BRIDGE_ROW)continue
    // Row keys sit in the column of `id`; home/enabled are read from its config block only.
    const indent=head[1].length,column=lines[i].indexOf('id:'),item={line:i+1,name:undefined,home:undefined,enabled:undefined}
    let config=-1
    for(let j=i+1;j<lines.length;j++){
      const line=lines[j];if(!line.trim()||line.trim().startsWith('#'))continue
      const lead=line.length-line.trimStart().length
      if(lead<=indent)break
      const field=/^\s*([A-Za-z]+):\s*['"]?([^'"#]*?)['"]?\s*(#.*)?$/.exec(line)
      if(!field)continue
      if(lead===column){config=field[1]==='config'?lead:-1;if(field[1]==='name')item.name=field[2];continue}
      if(config>=0&&lead>config&&['home','enabled'].includes(field[1])&&item[field[1]]===undefined)item[field[1]]=field[1]==='enabled'?field[2]==='true':field[2]
    }
    found.push(item)
  }
  return found
}

async function bridgeSummary(home){
  if(!home||!isAbsolute(home))return {home:home??null,available:false}
  const text=await readOptional(join(home,'bridge.json'))
  if(text===undefined)return {home,available:false}
  const data=JSON.parse(text),active=data.devices.filter(device=>!device.revokedAt)
  return {home,available:true,serverId:data.serverId,devices:active.length,agents:active.filter(device=>device.agents===true).length,submissions:Object.keys(data.submissions??{}).length,digest:sha(text)}
}
async function installed(dir,name){
  const text=await readOptional(join(dir,'node_modules',name,'package.json'))
  if(text===undefined)return null
  const manifest=JSON.parse(text)
  return {version:manifest.version,suite:Boolean(manifest.dsBotSuite),bridgeExport:Boolean(manifest.exports?.['./bridge'])}
}

export async function inspect({dshHome,profile}){
  const dir=join(dshHome,'profiles',profile),manifestText=await readOptional(join(dir,'package.json'))
  if(manifestText===undefined)throw Error(`No profile package.json in ${dir}`)
  const manifest=JSON.parse(manifestText),bundles=manifest.dsh?.profile?.bundles??[],dependencies=manifest.dependencies??{}
  const layers=[{file:join(dir,'cordis.patch.yml')},{file:join(dshHome,'cordis.patch.yml')}]
  for(const layer of layers)layer.overrides=bridgeOverrides(await readOptional(layer.file))
  const overrides=layers.flatMap(layer=>layer.overrides.map(item=>({...item,file:layer.file})))
  // The current Bridge provisions this dedicated location on owner first use.
  // Preserve the old explicit-home precedence; inspection never creates either.
  const home=overrides.map(item=>item.home).filter(Boolean).at(-1)??join(dshHome,'data',BRIDGE_ROW)
  const engine=await installed(dir,'ds-bot')
  const problems=[]
  for(const item of overrides)if(item.name&&item.name!=='ds-bot/bridge')problems.push(`${item.file}:${item.line} names the Bridge row "${item.name}"; DSH skips that override for the single package ("name mismatch"). Remove the name line yourself before switching.`)
  const selectedOld=OLD_BUNDLES.filter(name=>bundles.includes(name))
  if(engine?.suite&&selectedOld.length)problems.push(`The single package is installed while ${selectedOld.join(', ')} is still selected: two rows share the ID ${BRIDGE_ROW} and which Bridge code runs depends on bundle order. Run deselect.`)
  return {dir,bundles,selectedOld,dependencies:Object.fromEntries(['ds-bot',...OLD_BUNDLES,GATEWAY].filter(name=>name in dependencies).map(name=>[name,dependencies[name]])),
    gateway:{installed:GATEWAY in dependencies,selected:bundles.includes(GATEWAY)},engine,overrides,bridge:await bridgeSummary(home),problems,manifestDigest:sha(manifestText)}
}

export async function backup({dshHome,profile,to}){
  const report=await inspect({dshHome,profile})
  try{await stat(to);throw Error(`Backup target ${to} already exists`)}catch(error){if(error.code!=='ENOENT')throw error}
  await mkdir(join(to,'profile'),{recursive:true,mode:0o700})
  const files={}
  for(const name of PROFILE_FILES){const text=await readOptional(join(report.dir,name));if(text===undefined)continue;await writeFile(join(to,'profile',name),text,{mode:0o600});files[name]=sha(text)}
  const homeText=await readOptional(join(dshHome,'cordis.patch.yml'))
  if(homeText!==undefined){await writeFile(join(to,'home.cordis.patch.yml'),homeText,{mode:0o600});files['home.cordis.patch.yml']=sha(homeText)}
  if(report.bridge.available)await cp(report.bridge.home,join(to,'bridge-home'),{recursive:true,filter:source=>!/\.tmp$/.test(source)})
  const record={version:1,createdAt:new Date().toISOString(),dshHome,profile,files,bundles:report.bundles,dependencies:report.dependencies,engine:report.engine,
    bridge:report.bridge.available?{home:report.bridge.home,serverId:report.bridge.serverId,devices:report.bridge.devices,agents:report.bridge.agents,digest:report.bridge.digest}:null}
  await writeFile(join(to,'backup.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600})
  return record
}

async function loadBackup(dir,{dshHome,profile}){
  const record=JSON.parse(await readFile(join(dir,'backup.json'),'utf8'))
  if(record.version!==1||resolve(record.dshHome)!==resolve(dshHome)||record.profile!==profile)throw Error('This backup belongs to another profile')
  for(const [name,digest] of Object.entries(record.files)){const path=name==='home.cordis.patch.yml'?join(dir,name):join(dir,'profile',name);if(sha(await readFile(path,'utf8'))!==digest)throw Error(`Backup file ${name} is damaged`)}
  return record
}
const requireStopped=flag=>{if(!flag)throw Error('Stop DSH first and pass --dsh-stopped; the plugin manager rewrites the same files while it runs')}

// Unselects the two old bundles only. Their packages stay installed for rollback.
export async function deselect({dshHome,profile,backup:dir,dshStopped}){
  requireStopped(dshStopped)
  const record=await loadBackup(dir,{dshHome,profile}),path=join(dshHome,'profiles',profile,'package.json'),text=await readFile(path,'utf8')
  if(sha(text)!==record.files['package.json'])throw Error('The profile changed after the backup; take a new backup first')
  const manifest=JSON.parse(text),bundles=manifest.dsh?.profile?.bundles??[]
  const next=bundles.filter(name=>!OLD_BUNDLES.includes(name))
  if(next.length===bundles.length)return {changed:false,bundles}
  manifest.dsh={...manifest.dsh,profile:{...manifest.dsh.profile,bundles:next}}
  await writeAtomic(path,JSON.stringify(manifest,null,2)+'\n')
  return {changed:true,bundles:next}
}

export async function verify({dshHome,profile,backup:dir}){
  const record=await loadBackup(dir,{dshHome,profile}),report=await inspect({dshHome,profile}),failures=[...report.problems]
  if(!report.bundles.includes('ds-bot'))failures.push('ds-bot is not selected')
  if(!report.engine?.suite||!report.engine.bridgeExport)failures.push('node_modules/ds-bot is not the single package')
  if(report.selectedOld.length)failures.push(`${report.selectedOld.join(', ')} still selected`)
  if(record.bridge){
    if(!report.bridge.available)failures.push('Bridge home not found in the owner override or automatic storage location')
    else{
      if(report.bridge.serverId!==record.bridge.serverId)failures.push('Bridge server identity changed; paired phones would need to pair again')
      if(report.bridge.devices<record.bridge.devices)failures.push(`Paired devices dropped from ${record.bridge.devices} to ${report.bridge.devices}`)
    }
  }
  if(record.dependencies[GATEWAY]!==report.dependencies[GATEWAY])failures.push(`${GATEWAY} changed during migration`)
  return {ok:failures.length===0,failures,bundles:report.bundles,engine:report.engine,devices:report.bridge.devices??null}
}

export async function rollback({dshHome,profile,backup:dir,dshStopped,bridgeHome=false}){
  requireStopped(dshStopped)
  const record=await loadBackup(dir,{dshHome,profile}),profileDir=join(dshHome,'profiles',profile),restored=[]
  for(const name of Object.keys(record.files)){
    if(name==='home.cordis.patch.yml'){await writeAtomic(join(dshHome,'cordis.patch.yml'),await readFile(join(dir,name),'utf8'));restored.push(join(dshHome,'cordis.patch.yml'));continue}
    await writeAtomic(join(profileDir,name),await readFile(join(dir,'profile',name),'utf8'));restored.push(join(profileDir,name))
  }
  // Files the backup did not have (for example a lockfile pnpm created) are left
  // in place on purpose; the reinstall below rewrites them.
  if(bridgeHome&&record.bridge){
    const target=record.bridge.home,aside=`${target}.before-rollback-${Date.now()}`
    await rename(target,aside)
    await cp(join(dir,'bridge-home'),target,{recursive:true})
    restored.push(target)
  }
  const engine=await installed(profileDir,'ds-bot')
  return {restored,reinstall:engine?.suite?`node_modules/ds-bot is still the single package; reinstall the previous engine "${record.dependencies['ds-bot']}" with the DSH plugin manager.`:null}
}

const human=(command,result)=>JSON.stringify(result,(key,value)=>key==='digest'||key==='manifestDigest'?undefined:key==='serverId'&&typeof value==='string'?value.slice(0,8)+'…':value,2)
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {positionals:[command='plan'],values}=parseArgs({allowPositionals:true,options:{'dsh-home':{type:'string'},profile:{type:'string'},to:{type:'string'},backup:{type:'string'},'dsh-stopped':{type:'boolean',default:false},'bridge-home':{type:'boolean',default:false}}})
  if(!values['dsh-home']||!values.profile){const dirs=values['dsh-home']?await readdir(join(values['dsh-home'],'profiles')).catch(()=>[]):[];throw Error(`Pass --dsh-home and --profile${dirs.length?` (profiles: ${dirs.join(', ')})`:''}`)}
  const options={dshHome:resolve(values['dsh-home']),profile:values.profile,to:values.to&&resolve(values.to),backup:values.backup&&resolve(values.backup),dshStopped:values['dsh-stopped'],bridgeHome:values['bridge-home']}
  const run={plan:inspect,backup,deselect,verify,rollback}[command]
  if(!run)throw Error(`Unknown command ${command}`)
  if(command==='backup'&&!options.to)throw Error('Pass --to <new backup directory>')
  if(['deselect','verify','rollback'].includes(command)&&!options.backup)throw Error('Pass --backup <backup directory>')
  const result=await run(options)
  console.log(human(command,result))
  if(command==='verify'&&!result.ok)process.exitCode=1
}
