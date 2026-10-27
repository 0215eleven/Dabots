// Builds the compatible DS Bot engine: the integrity-pinned public ds-bot@0.1.7
// with this repository's reviewed Bridge patch (groups + DSH Agent contract).
// Run `npm --prefix bridge run test:prepare` first; it downloads and verifies the
// public package and applies the patch into bridge/fixture/extended.
import {execFileSync} from 'node:child_process'
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join,relative,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {npmCommand} from './npm-command.mjs'
export const VERSION='0.1.7-agent.1'
const root=new URL('../',import.meta.url),out=new URL('artifacts/',root)
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim()
if(git('status','--porcelain','--untracked-files=normal'))throw Error('Commit all source and documentation before packaging')
const commit=git('rev-parse','HEAD')
const source=fileURLToPath(new URL('bridge/fixture/extended/package/',root)),vanilla=fileURLToPath(new URL('bridge/fixture/vanilla/package/',root))
const base=JSON.parse(await readFile(join(vanilla,'package.json'),'utf8'))
if(base.name!=='ds-bot'||base.version!=='0.1.7')throw Error('Run npm --prefix bridge run test:prepare first')
// The packaged channel must be exactly the pristine file plus the checked-in patch.
const patch=await readFile(new URL('group-bridge/patches/ds-bot-0.1.7-groups.patch',root),'utf8')
const check=await mkdtemp(join(tmpdir(),'ds-bot-patch-'))
try{
  await cp(vanilla,check,{recursive:true,filter:item=>!relative(vanilla,item).split(sep).includes('node_modules')})
  execFileSync('git',['apply','--no-index','-'],{cwd:check,input:patch.replaceAll('\r\n','\n')})
  if(await readFile(join(check,'src/host/channel.js'),'utf8')!==await readFile(join(source,'src/host/channel.js'),'utf8'))throw Error('Prepared fixture does not match the checked-in patch; run test:prepare again')
}finally{await rm(check,{recursive:true,force:true})}
const stage=await mkdtemp(join(tmpdir(),'ds-bot-stage-'))
try{
  await cp(source,stage,{recursive:true,filter:item=>!relative(source,item).split(sep).includes('node_modules')})
  const manifest={...base,version:VERSION}
  await writeFile(join(stage,'package.json'),JSON.stringify(manifest,null,2)+'\n')
  // Apache-2.0 §4(b): state the modification next to the original LICENSE.
  await writeFile(join(stage,'PATCHED.md'),`# Modified package\n\nThis is public \`ds-bot@0.1.7\` (Apache-2.0) with \`src/host/channel.js\` modified by\n\`group-bridge/patches/ds-bot-0.1.7-groups.patch\` from 0215eleven/ds-bot-mobile-app at\n${commit}: the Mobile Bridge contract (bridge.describe/submit/redact), group\nprojection and the owner-granted DSH Agent entry (bridge.agent-open/agent-new).\nNo other file changed. The original LICENSE is retained.\n`)
  manifest.files=[...new Set([...(manifest.files??[]),'PATCHED.md'])]
  await writeFile(join(stage,'package.json'),JSON.stringify(manifest,null,2)+'\n')
  await mkdir(out,{recursive:true})
  const [packed]=JSON.parse(execFileSync(...npmCommand(['pack',stage,'--ignore-scripts','--json','--pack-destination',fileURLToPath(out)]),{cwd:root,encoding:'utf8',windowsHide:true}))
  if(!packed.files.some(f=>f.path==='LICENSE')||!packed.files.some(f=>f.path==='PATCHED.md'))throw Error('License or modification notice missing from the archive')
  if(git('rev-parse','HEAD')!==commit)throw Error('Source changed while packaging')
  const sha256=createHash('sha256').update(await readFile(new URL(packed.filename,out))).digest('hex')
  console.log(JSON.stringify({name:manifest.name,version:manifest.version,commit,filename:packed.filename,sha256}))
}finally{await rm(stage,{recursive:true,force:true})}
