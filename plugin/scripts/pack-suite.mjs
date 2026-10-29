// Packs the single DS Bot package: one name (`ds-bot`), one version, one install.
//   npm run pack:plugin
// Defaults to the production source in plugin/engine. An optional external engine
// must have an explicit source description. `--dev` allows the isolated 0.1.7
// fixture engine for development; such archives are marked and are not deliverables.
import {execFileSync} from 'node:child_process'
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {npmCommand} from './npm-command.mjs'
import {composeClient,composeManifest,composePatch,engineContract,stageBridge,stageEngine} from './suite-lib.mjs'
import {bundleCompanion} from '../ui/build.mjs'

export const SUITE_REVISION=3
const {values:args}=parseArgs({options:{engine:{type:'string'},'engine-source':{type:'string'},dev:{type:'boolean',default:false},out:{type:'string'}}})
if(args.engine&&!args['engine-source'])throw Error('An external engine requires --engine-source "<origin>"')
const root=new URL('../../',import.meta.url),out=args.out?resolve(args.out):fileURLToPath(new URL('artifacts/',root))
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim()
const dirty=git('status','--porcelain','--untracked-files=normal')
if(dirty&&!args.dev)throw Error('Commit all source and documentation before packaging')
const commit=git('rev-parse','HEAD'),engineDir=args.engine?resolve(args.engine):fileURLToPath(new URL(args.dev?'plugin/bridge/fixture/extended/package':'plugin/engine',root)),bridgeDir=fileURLToPath(new URL('plugin/bridge',root))
const engineSource=args['engine-source']??(args.dev?'isolated public 0.1.7 + reviewed repository patch':'repository plugin/engine; see PATCHED.md')

const engine=JSON.parse(await readFile(join(engineDir,'package.json'),'utf8'))
const channel=await readFile(join(engineDir,'src/host/channel.js'),'utf8')
const contract=engineContract(channel)
if(contract.missing.length)throw Error(`Engine lacks the Bridge contract (${contract.missing.join(', ')})`)
const base=String(engine.version).split('-')[0]
if(!/^\d+\.\d+\.\d+$/.test(base))throw Error('Unrecognized engine version')
if(!args.dev&&base!=='0.2.0')throw Error(`Expected the production ds-bot 0.2.0 engine, found ${engine.version}`)
const version=`${base}-pro.1${args.dev?'.dev':''}`
// Fingerprint the entry contract/client; the full TGZ has its own SHA-256 below.
const fingerprint=createHash('sha256').update(await readFile(join(engineDir,'package.json'))).update(channel).update(await readFile(join(engineDir,'client.js')))
try{fingerprint.update(await readFile(join(engineDir,'src/host/mobile-bridge.js')))}catch(error){if(error.code!=='ENOENT')throw error}
const engineDigest=fingerprint.digest('hex')

const stage=await mkdtemp(join(tmpdir(),'ds-bot-suite-'))
try{
  await stageEngine({engineDir,target:stage})
  const bridge=await stageBridge({bridgeDir,target:stage})
  const suite={revision:SUITE_REVISION,dev:args.dev,source:{repository:'0215eleven/ds-bot-mobile',commit,dirty:Boolean(dirty)},
    engine:{version:engine.version,source:engineSource,digest:engineDigest,agents:contract.agents},bridge:{version:bridge.version},
    companion:{version:JSON.parse(await readFile(new URL('plugin/ui/package.json',root),'utf8')).version}}
  const manifest=composeManifest({engine,bridge,version,suite})
  await writeFile(join(stage,'package.json'),JSON.stringify(manifest,null,2)+'\n')
  await writeFile(join(stage,'client.js'),composeClient({engineClient:await readFile(join(engineDir,'client.js'),'utf8'),mobileBundle:await bundleCompanion({bundleKey:'ds-bot'})}))
  await writeFile(join(stage,'cordis.patch.yml'),composePatch({enginePatch:await readFile(join(engineDir,'cordis.patch.yml'),'utf8'),bridgePatch:await readFile(join(bridgeDir,'cordis.patch.yml'),'utf8')}))
  let engineNotice=''
  try{engineNotice=await readFile(join(engineDir,'NOTICE'),'utf8')}catch{}
  await writeFile(join(stage,'NOTICE'),`${engineNotice?engineNotice.trimEnd()+'\n\n':''}DeepSeek Bot Pro (ds-bot ${version})
Composed from the DS Bot engine above, the DS Bot Mobile Bridge (bridge/) and
the Mobile App desktop pairing UI merged into client.js, from
https://github.com/0215eleven/ds-bot-mobile at ${commit}, Apache-2.0.
See bridge/NOTICE for Bridge provenance. The relay transport adapts MIT-licensed
NaCl envelope and secretbox code from slopus/happy at
d6b85a0dda14c9582e1f083539fd11d99924022f, Copyright (c) 2026 Happy Coder
Contributors; full notices are in bridge/THIRD_PARTY_RELAY_NOTICES.txt. It does
not use Happy's accounts, database or public services.
`)
  await writeFile(join(stage,'SUITE.md'),`# DeepSeek Bot Pro single package\n\n${args.dev?'**Development build. It uses the isolated public 0.1.7 + repository patch engine and must not be installed in a real Harness.**\n\n':''}| Part | Version | Source |\n| --- | --- | --- |\n| Engine (rows \`bot\`, \`web-search-auto\`) | ${engine.version} | ${engineSource} (digest ${engineDigest}) |\n| Mobile Bridge (row \`ds-bot-mobile-bridge\`, \`ds-bot/bridge\`) | ${bridge.version} | 0215eleven/ds-bot-mobile ${commit}${dirty?' (uncommitted changes)':''} |\n| Pairing and connection settings (in client.js) | ${suite.companion.version} | same |\n\nThe engine files are unchanged except package.json, client.js (engine client plus\nthe settings UI), cordis.patch.yml (adds the Bridge row) and NOTICE.\nThe Bridge needs the engine's Bridge contract; DSH Agent from the phone: ${contract.agents?'available':'not offered by this engine'}.\n`)
  await mkdir(out,{recursive:true})
  const [packed]=JSON.parse(execFileSync(...npmCommand(['pack',stage,'--ignore-scripts','--json','--pack-destination',out]),{cwd:root,encoding:'utf8',windowsHide:true}))
  const paths=packed.files.map(f=>f.path)
  for(const required of ['LICENSE','NOTICE','SUITE.md','client.js','cordis.patch.yml','bridge/index.mjs','bridge/src/relay-client.mjs','bridge/THIRD_PARTY_RELAY_NOTICES.txt','bridge/LICENSE'])if(!paths.includes(required))throw Error(`Archive is missing ${required}`)
  const leaked=paths.filter(p=>/(^|\/)(\.env|\.npmrc|node_modules\/)|\.(log|pem|key|p12|sqlite)$|(^|\/)(pairings|devices|tokens|remote-connection|relay-identity)\.json$/i.test(p))
  if(leaked.length)throw Error(`Archive contains files that must not ship: ${leaked.join(', ')}`)
  if(!args.dev&&(git('status','--porcelain','--untracked-files=normal')||git('rev-parse','HEAD')!==commit))throw Error('Source changed while packaging')
  const sha256=createHash('sha256').update(await readFile(join(out,packed.filename))).digest('hex')
  const release={name:manifest.name,version,commit,engine:suite.engine,filename:packed.filename,files:paths.length,sha256}
  await writeFile(join(out,'plugin-release.json'),JSON.stringify(release,null,2)+'\n')
  await writeFile(join(out,'SHA256SUMS-plugin'),`${sha256}  ${packed.filename}\n`)
  console.log(JSON.stringify(release))
}finally{await rm(stage,{recursive:true,force:true})}

