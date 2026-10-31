import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {npmCommand} from '../npm-command.mjs'

const root=resolve(import.meta.dirname,'../../..')
// SHA-256 of the unmodified LICENSE in @norbert_bodziony/bloub@0.4.1.
const upstreamLicenseDigest='d43fe2742faaf4a86210ec33bb155f101f64883e3994be9193099367940736b4'

async function outputDirectory(t){
  const out=await mkdtemp(join(tmpdir(),'ds-bot-license-pack-'))
  t.after(()=>rm(out,{recursive:true,force:true}))
  return out
}
function run(command,args,options={}){
  const result=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:60_000,maxBuffer:8*1024*1024,...options})
  assert.equal(result.status,0,result.stderr||result.error?.message)
  return result.stdout
}
function archiveFile(archive,file){
  return run('tar',['-xOf',archive,`package/${file}`])
}
function assertBloubTerms(archive){
  const notice=archiveFile(archive,'NOTICE')
  assert.match(notice,/@norbert_bodziony\/bloub(?:@| )0\.4\.1/)
  assert.match(notice,/https:\/\/github\.com\/NorbertBodziony\/bloub/)
  assert.match(notice,/Copyright \(c\) 2026 Jérémy Perret/)
  assert.match(notice,/THIRD_PARTY_BLOUB_LICENSE\.txt/)
  const license=archiveFile(archive,'THIRD_PARTY_BLOUB_LICENSE.txt')
  assert.equal(createHash('sha256').update(license).digest('hex'),upstreamLicenseDigest)
}

test('source engine archive carries the Bloub attribution and exact MIT license',async t=>{
  const out=await outputDirectory(t)
  const [packed]=JSON.parse(run(...npmCommand(['pack',join(root,'plugin/engine'),'--ignore-scripts','--json','--pack-destination',out])))
  assertBloubTerms(join(out,packed.filename))
})

for(const [label,engine] of [
  ['production source','plugin/engine'],
  ['public 0.1.7 compatibility input','plugin/bridge/fixture/extended/package'],
])test(`composed archive carries Bloub terms when branding ${label}`,async t=>{
  const out=await outputDirectory(t)
  const legacy=join(out,'ds-bot-legacy.tgz')
  await writeFile(legacy,'existing historical artifact\n')
  const stdout=run(process.execPath,[join(root,'plugin/scripts/pack-suite.mjs'),'--dev','--engine',join(root,engine),'--engine-source',`license test: ${label}`,'--out',out])
  const release=JSON.parse(stdout.trim().split('\n').at(-1))
  const archive=join(out,release.filename)
  assert.match(release.filename,/^Dabots-.*\.tgz$/)
  assert.equal(JSON.parse(archiveFile(archive,'package.json')).name,'ds-bot')
  assert.match(archiveFile(archive,'README.md'),/^# Dabots\n/)
  assertBloubTerms(archive)
  assert.match(archiveFile(archive,'client.js'),/BT-BLOUB-BRAND/)
  assert.match(archiveFile(archive,'NOTICE'),/THIRD_PARTY_RELAY_NOTICES\.txt/)
  assert.equal(await readFile(legacy,'utf8'),'existing historical artifact\n')
  const before=await readFile(archive)
  const repeated=spawnSync(process.execPath,[join(root,'plugin/scripts/pack-suite.mjs'),'--dev','--engine',join(root,engine),'--engine-source',`license test: ${label}`,'--out',out],{cwd:root,encoding:'utf8',timeout:60_000})
  assert.notEqual(repeated.status,0)
  assert.match(repeated.stderr,/EEXIST/)
  assert.deepEqual(await readFile(archive),before,'repeat packaging cannot replace the prior candidate')
})
