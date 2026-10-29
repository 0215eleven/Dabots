import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {backup,bridgeOverrides,deselect,inspect,rollback,verify} from '../migrate-suite.mjs'

const script=resolve(import.meta.dirname,'../migrate-suite.mjs')
const secretHash='a'.repeat(64)
async function profile({bridgeName}={}){
  const dshHome=await mkdtemp(join(tmpdir(),'ds-bot-migrate-')),dir=join(dshHome,'profiles/desktop'),bridgeHome=join(dshHome,'bridge-home')
  await mkdir(join(dir,'node_modules/ds-bot'),{recursive:true});await mkdir(bridgeHome,{recursive:true})
  await writeFile(join(dir,'package.json'),JSON.stringify({private:true,dependencies:{'ds-bot':'link:G:/dsbotwork/mobile-bridge/port/ds-bot','ds-bot-mobile-bridge':'file:bridge.tgz','ds-bot-mobile-app':'file:companion.tgz','dsh-plugin-mobile-gateway':'0.11.1'},
    dsh:{profile:{bundles:['@deepseek-ai/dsh-base','ds-bot','ds-bot-mobile-bridge','ds-bot-mobile-app','dsh-plugin-mobile-gateway']}}},null,2))
  await writeFile(join(dir,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n')
  await writeFile(join(dir,'cordis.patch.yml'),`# owner settings\n- id: web\n  config:\n    searchProvider: auto\n- id: ds-bot-mobile-bridge\n${bridgeName?`  name: ${bridgeName}\n`:''}  config:\n    enabled: true\n    home: ${bridgeHome}\n    port: 8787\n`)
  await writeFile(join(dir,'node_modules/ds-bot/package.json'),JSON.stringify({name:'ds-bot',version:'0.2.0'}))
  const device=(id,extra={})=>({id,name:id,accessHash:secretHash,refreshHash:secretHash,...extra})
  await writeFile(join(bridgeHome,'bridge.json'),JSON.stringify({version:1,serverId:'server-1234567890',devices:[device('a',{agents:true}),device('b'),device('gone',{revokedAt:1})],submissions:{r1:{}},uploads:{},readMarkers:{}}))
  return {dshHome,profile:'desktop',dir,bridgeHome}
}
const installSuite=dir=>writeFile(join(dir,'node_modules/ds-bot/package.json'),JSON.stringify({name:'ds-bot',version:'0.2.0-suite.1',exports:{'.':'./index.js','./bridge':'./bridge/index.mjs'},dsBotSuite:{revision:1}}))

test('the override reader finds the Bridge row, its name and home', () => {
  const rows=bridgeOverrides('- id: other\n  config:\n    home: /x\n-   id: "ds-bot-mobile-bridge"  # mine\n    name: ds-bot-mobile-bridge\n    config:\n      enabled: true\n      name: Display name\n      home: "C:\\\\bridge"\n- id: next\n')
  assert.deepEqual(bridgeOverrides('- id: ds-bot-mobile-bridge\n  config:\n    name: Only the display name\n')[0].name,undefined)
  assert.equal(rows.length,1); assert.equal(rows[0].name,'ds-bot-mobile-bridge'); assert.equal(rows[0].enabled,true); assert.equal(rows[0].home,'C:\\\\bridge')
})

test('plan reports the old bundles, the gateway and the Bridge without touching anything', async () => {
  const p=await profile()
  try{
    const before=await readFile(join(p.dir,'package.json'),'utf8'),report=await inspect(p)
    assert.deepEqual(report.selectedOld,['ds-bot-mobile-bridge','ds-bot-mobile-app'])
    assert.deepEqual(report.gateway,{installed:true,selected:true})
    assert.equal(report.bridge.devices,2); assert.equal(report.bridge.agents,1)
    assert.deepEqual(report.problems,[])
    assert.equal(await readFile(join(p.dir,'package.json'),'utf8'),before)
    const printed=execFileSync(process.execPath,[script,'plan','--dsh-home',p.dshHome,'--profile','desktop'],{encoding:'utf8'})
    assert.equal(printed.includes(secretHash),false); assert.equal(printed.includes('server-1234567890'),false)
  }finally{await rm(p.dshHome,{recursive:true,force:true})}
})

test('migrate, verify, roll back and migrate again keep pairings and leave the gateway alone', async () => {
  const p=await profile(),to=join(p.dshHome,'backup-1')
  try{
    await backup({...p,to})
    await assert.rejects(backup({...p,to}),/already exists/)
    await assert.rejects(deselect({...p,backup:to}),/Stop DSH first/)
    assert.deepEqual((await deselect({...p,backup:to,dshStopped:true})).bundles,['@deepseek-ai/dsh-base','ds-bot','dsh-plugin-mobile-gateway'])
    const manifest=JSON.parse(await readFile(join(p.dir,'package.json'),'utf8'))
    assert.equal(manifest.dependencies['ds-bot-mobile-bridge'],'file:bridge.tgz','old packages stay installed for rollback')
    assert.equal((await verify({...p,backup:to})).ok,false,'the old engine is not the single package')
    await installSuite(p.dir)
    const verified=await verify({...p,backup:to})
    assert.deepEqual(verified.failures,[]); assert.equal(verified.devices,2)
    const back=await rollback({...p,backup:to,dshStopped:true})
    assert.match(back.reinstall,/link:G:\/dsbotwork\/mobile-bridge\/port\/ds-bot/)
    assert.deepEqual(JSON.parse(await readFile(join(p.dir,'package.json'),'utf8')).dsh.profile.bundles,['@deepseek-ai/dsh-base','ds-bot','ds-bot-mobile-bridge','ds-bot-mobile-app','dsh-plugin-mobile-gateway'])
    assert.equal(JSON.parse(await readFile(join(p.bridgeHome,'bridge.json'),'utf8')).devices.length,3,'the Bridge home is kept unless asked')
    const again=join(p.dshHome,'backup-2');await backup({...p,to:again})
    await deselect({...p,backup:again,dshStopped:true})
    assert.equal((await verify({...p,backup:again})).ok,true)
  }finally{await rm(p.dshHome,{recursive:true,force:true})}
})

test('a stale backup, a renamed override, a lost device or a dual selection is reported', async () => {
  const p=await profile({bridgeName:'ds-bot-mobile-bridge'}),to=join(p.dshHome,'backup')
  try{
    assert.match((await inspect(p)).problems[0],/name mismatch/)
    await backup({...p,to})
    await installSuite(p.dir)
    assert.ok((await inspect(p)).problems.some(item=>/depends on bundle order/.test(item)))
    const manifest=JSON.parse(await readFile(join(p.dir,'package.json'),'utf8'));manifest.dependencies.extra='1.0.0'
    await writeFile(join(p.dir,'package.json'),JSON.stringify(manifest))
    await assert.rejects(deselect({...p,backup:to,dshStopped:true}),/changed after the backup/)
    const data=JSON.parse(await readFile(join(p.bridgeHome,'bridge.json'),'utf8'));data.devices[0].revokedAt=2
    await writeFile(join(p.bridgeHome,'bridge.json'),JSON.stringify(data))
    const result=await verify({...p,backup:to})
    assert.ok(result.failures.some(item=>/dropped from 2 to 1/.test(item)))
    assert.ok(result.failures.some(item=>/still selected/.test(item)))
    await rollback({...p,backup:to,dshStopped:true,bridgeHome:true})
    assert.equal(JSON.parse(await readFile(join(p.bridgeHome,'bridge.json'),'utf8')).devices.filter(d=>!d.revokedAt).length,2)
  }finally{await rm(p.dshHome,{recursive:true,force:true})}
})
