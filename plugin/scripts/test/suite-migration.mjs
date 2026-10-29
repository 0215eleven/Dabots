// Old four-bundle layout → single package → rollback, in an isolated public DSH
// 0.2.1-rc.2 profile, with one paired phone carried through every step:
//   node scripts/test/suite-migration.mjs
// Uses the development engine; the steps and checks are the same for the owner's engine.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import WebSocket from '../../bridge/node_modules/ws/wrapper.mjs'
import {MobileClient,MemoryTokenStore} from '../../../ios-app/sdk/index.js'
import {backup,deselect,inspect,rollback,verify} from '../migrate-suite.mjs'
import {createHome,devEngine,freePort,installArchive,installDir,launch,packProductionSuite,root,writeOwnerPatch,writeProfile} from './dsh-harness.mjs'

const env=await createHome('ds-bot-suite-migrate-'),bridgePort=await freePort(),delay=ms=>new Promise(r=>setTimeout(r,ms))
let passed=0,run;const check=name=>{passed++;console.log(`PASS ${name}`)}
const options={dshHome:env.home,profile:'web'}
async function waitFor(task,timeout=60000){const end=Date.now()+timeout;let error;while(Date.now()<end){try{return await task()}catch(cause){error=cause;await delay(150)}}throw error}
try{
  const suite=packProductionSuite(env.home)
  // Old layout: separate engine, Bridge and pairing UI bundles, plus an owner override.
  await installDir(env.modules,'ds-bot',devEngine)
  await installDir(env.modules,'ds-bot-mobile-bridge',join(root,'plugin/bridge'))
  await installDir(env.modules,'ds-bot-mobile-app',join(root,'plugin/ui'))
  await writeProfile(env,{dependencies:{'ds-bot':'file:ds-bot-0.1.7-agent.1.tgz','ds-bot-mobile-bridge':'file:bridge.tgz','ds-bot-mobile-app':'file:companion.tgz'},bundles:['ds-bot','ds-bot-mobile-bridge','ds-bot-mobile-app']})
  await writeOwnerPatch(env,bridgePort,'Migration')
  run=await launch(env,{bridgePort})
  const serverId=run.info.serverId
  const tokens=new MemoryTokenStore(),client=new MobileClient({baseUrl:run.bridgeUrl,allowInsecure:true,tokenStore:tokens,WebSocket,reconnectDelayMs:20})
  const pairing=await run.operator('pairing.create'),claim=await client.pair(pairing.code,'Migration phone')
  await run.operator('pairing.approve',{requestId:claim.requestId})
  await client.completePairing(claim.claimToken)
  const room=(await client.conversations()).conversations[0]
  const message={conversationId:room.id,sessionId:room.sessionId,requestId:'migration_stable_1',text:'before migration'}
  const receipt=await client.submit(message)
  await waitFor(async()=>assert.ok((await client.messages(room.id)).messages.some(row=>row.role==='assistant')))
  check('old layout: phone paired, message accepted and answered')
  await run.stop();run=null

  const backupDir=join(env.home,'backup')
  assert.deepEqual((await inspect(options)).problems,[])
  await backup({...options,to:backupDir})
  await deselect({...options,backup:backupDir,dshStopped:true})
  // The DSH plugin manager step: the single package replaces the ds-bot dependency.
  await installArchive(env.modules,'ds-bot',join(env.home,suite.filename))
  const manifest=JSON.parse(await readFile(join(env.profile,'package.json'),'utf8'))
  manifest.dependencies['ds-bot']=`file:${suite.filename}`
  await writeFile(join(env.profile,'package.json'),JSON.stringify(manifest,null,2)+'\n')
  assert.deepEqual((await verify({...options,backup:backupDir})).failures,[])
  check('backup, deselect and install leave a verified single-package profile')

  run=await launch(env,{bridgePort})
  assert.equal(run.info.serverId,serverId)
  const state=await client.state()
  assert.ok(Array.isArray(state.bots))
  check('single package: same Bridge identity and the old phone token still works')
  assert.deepEqual(await client.submit(message),receipt)
  assert.deepEqual(await client.submission(message.requestId),receipt)
  const history=await client.messages(room.id)
  assert.equal(history.messages.filter(row=>row.text===message.text).length,1)
  check('retrying the pre-migration request returns its receipt without a second write')
  const devices=(await run.operator('status')).devices.filter(item=>!item.revokedAt)
  assert.deepEqual(devices.map(item=>item.name),['Migration phone'])
  const served=await run.clientScripts()
  assert.ok(served.includes('mobile connection settings unavailable'))
  assert.equal(/id:\s*['"]ds-bot-mobile-app['"]/.test(served),false)
  check('device list carried over and only the merged pairing UI is served')
  await run.stop();run=null

  const back=await rollback({...options,backup:backupDir,dshStopped:true})
  assert.match(back.reinstall,/ds-bot-0\.1\.7-agent\.1\.tgz/)
  await installDir(env.modules,'ds-bot',devEngine)
  run=await launch(env,{bridgePort})
  assert.equal(run.info.serverId,serverId)
  await client.state()
  assert.deepEqual(await client.submission(message.requestId),receipt)
  const served2=await run.clientScripts()
  assert.ok(/id:\s*['"]ds-bot-mobile-app['"]/.test(served2))
  check('rollback: old bundles back, same phone token and receipt')
  console.log(`${passed} migration checks passed`)
}finally{await run?.stop();await env.dispose()}
