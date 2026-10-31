import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {backup,bridgeOverrides,deselect,inspect,rollback,verify} from '../migrate-suite.mjs'

const script=resolve(import.meta.dirname,'../migrate-suite.mjs')
const secretHash='a'.repeat(64)
async function profile({bridgeName,automaticHome=false}={}){
  const dshHome=await mkdtemp(join(tmpdir(),'ds-bot-migrate-')),dir=join(dshHome,'profiles/desktop'),bridgeHome=automaticHome?join(dshHome,'data','ds-bot-mobile-bridge'):join(dshHome,'bridge-home')
  await mkdir(join(dir,'node_modules/ds-bot'),{recursive:true});await mkdir(bridgeHome,{recursive:true})
  await writeFile(join(dir,'package.json'),JSON.stringify({private:true,dependencies:{'ds-bot':'link:G:/dsbotwork/mobile-bridge/port/ds-bot','ds-bot-mobile-bridge':'file:bridge.tgz','ds-bot-mobile-app':'file:companion.tgz','dsh-plugin-mobile-gateway':'0.11.1'},
    dsh:{profile:{bundles:['@deepseek-ai/dsh-base','ds-bot','ds-bot-mobile-bridge','ds-bot-mobile-app','dsh-plugin-mobile-gateway']}}},null,2))
  await writeFile(join(dir,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n')
  await writeFile(join(dir,'cordis.patch.yml'),`# owner settings\n- id: web\n  config:\n    searchProvider: auto\n${automaticHome?'':`- id: ds-bot-mobile-bridge\n${bridgeName?`  name: ${bridgeName}\n`:''}  config:\n    enabled: true\n    home: ${bridgeHome}\n    port: 8787\n`}`)
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
    const back=await rollback({...p,backup:to,dshStopped:true,bridgeHome:false})
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

test('automatic storage is discovered and its state, keys and saved selection survive backup, migration and explicit state rollback', async () => {
  const p=await profile({automaticHome:true}),to=join(p.dshHome,'backup')
  try{
    const state=await readFile(join(p.bridgeHome,'bridge.json'),'utf8')
    const files={
      'bridge.json':state,
      'relay-identity.json':JSON.stringify({version:1,ed:'fixture-only-private-identity',x:{publicKey:'fixture-only-public-key',secretKey:'fixture-only-private-key'}}),
      'relay-connection.json':JSON.stringify({version:1,mode:'relay',relay:'wss://private.fixture.example',secret:'fixture-only-prior-private-secret'}),
      'relay-selection.json':JSON.stringify({version:1,mode:'official'}),
      'remote-connection.json':JSON.stringify({version:1,mode:'quick'}),
    }
    for(const [name,text] of Object.entries(files))await writeFile(join(p.bridgeHome,name),text,{mode:0o600})
    const report=await inspect(p)
    assert.deepEqual(report.overrides,[],'automatic storage needs no owner form or patch row')
    assert.equal(report.bridge.home,p.bridgeHome);assert.equal(report.bridge.available,true)
    assert.equal(report.bridge.devices,2);assert.equal(report.bridge.agents,1)
    const record=await backup({...p,to})
    assert.equal(record.bridge.home,p.bridgeHome)
    for(const [name,text] of Object.entries(files))assert.equal(await readFile(join(to,'bridge-home',name),'utf8'),text,`${name} is included in the backup`)
    await deselect({...p,backup:to,dshStopped:true});await installSuite(p.dir)
    const result=await verify({...p,backup:to})
    assert.equal(result.ok,true);assert.equal(result.devices,2)
    for(const [name,text] of Object.entries(files))assert.equal(await readFile(join(p.bridgeHome,name),'utf8'),text,`${name} is preserved during migration`)
    await writeFile(join(p.bridgeHome,'relay-selection.json'),JSON.stringify({version:1,mode:'direct'}))
    await rollback({...p,backup:to,dshStopped:true,bridgeHome:false})
    assert.equal(JSON.parse(await readFile(join(p.bridgeHome,'relay-selection.json'),'utf8')).mode,'direct','profile rollback preserves current device choices')
    await writeFile(join(p.bridgeHome,'bridge.json'),JSON.stringify({...JSON.parse(state),serverId:'changed-server',devices:[]}))
    const lost=await verify({...p,backup:to})
    assert.ok(lost.failures.some(message=>/server identity changed/.test(message)),'automatic server identity loss is detected')
    assert.ok(lost.failures.some(message=>/Paired devices dropped from 2 to 0/.test(message)),'automatic paired device loss is detected')
    await rollback({...p,backup:to,dshStopped:true,bridgeHome:true})
    for(const [name,text] of Object.entries(files))assert.equal(await readFile(join(p.bridgeHome,name),'utf8'),text,`${name} is restored only on explicit Bridge rollback`)
  }finally{await rm(p.dshHome,{recursive:true,force:true})}
})

test('explicit Bridge home wins over automatic storage and inspecting missing automatic storage stays read-only', async () => {
  const p=await profile(),automatic=join(p.dshHome,'data','ds-bot-mobile-bridge')
  try{
    await mkdir(automatic,{recursive:true})
    await writeFile(join(automatic,'bridge.json'),JSON.stringify({version:1,serverId:'other-automatic-server',devices:[]}))
    assert.equal((await inspect(p)).bridge.home,p.bridgeHome)
    await rm(automatic,{recursive:true})
    await writeFile(join(p.dir,'cordis.patch.yml'),'# no Bridge override\n')
    const report=await inspect(p)
    assert.deepEqual(report.bridge,{home:automatic,available:false})
    await assert.rejects(readFile(join(automatic,'bridge.json')),error=>error.code==='ENOENT')
  }finally{await rm(p.dshHome,{recursive:true,force:true})}
})
