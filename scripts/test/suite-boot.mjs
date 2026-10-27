// Fresh single-package install in an isolated public DSH 0.2.1-rc.2 profile:
//   node scripts/test/suite-boot.mjs [<ds-bot suite .tgz>]
// Without an archive it packs a development build from the isolated fixture engine.
// The profile selects only the `ds-bot` bundle and overrides the Bridge row by
// ID alone, the way an existing owner configuration does. No user profile is used.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHome,freePort,installArchive,launch,packDevSuite,writeOwnerPatch,writeProfile} from './dsh-harness.mjs'

const env=await createHome('ds-bot-suite-boot-')
let passed=0,run;const check=name=>{passed++;console.log(`PASS ${name}`)}
try{
  const archive=process.argv[2]?resolve(process.argv[2]):join(env.home,packDevSuite(env.home).filename)
  await installArchive(env.modules,'ds-bot',archive)
  const suite=JSON.parse(await readFile(join(env.modules,'ds-bot/package.json'),'utf8'))
  await writeProfile(env,{dependencies:{'ds-bot':suite.version},bundles:['ds-bot']})
  await writeOwnerPatch(env,await freePort(),'Suite boot')
  run=await launch(env,{bridgePort:Number(/port: (\d+)/.exec(await readFile(join(env.profile,'cordis.patch.yml'),'utf8'))[1])})
  assert.equal(run.info.name,'Suite boot')
  check('ds-bot/bridge row starts from the single package with the owner override applied by row ID')
  assert.equal(run.info.capabilities?.groups,true)
  check('Bridge reaches the engine contract in the same package')
  assert.equal((await run.operator('status')).enabled,true)
  check('owner operator answers through the DSH web carrier')
  const served=await run.clientScripts()
  assert.ok(/load\(\{id:"ds-bot",factory/.test(served),'merged ds-bot client is not served')
  assert.ok(served.includes('mobile connection settings unavailable'),'merged client lacks the mobile settings part')
  assert.equal(/id:\s*['"]ds-bot-mobile-app['"]/.test(served),false)
  check('one client module (ds-bot) carries the Bot UI and the pairing settings')
  assert.equal(/patch: (name mismatch|entry .* not found)|client-modules:/.test(run.output()),false,run.output())
  check('no patch or client-module warnings')
  console.log(`${passed} suite boot checks passed`)
}finally{await run?.stop();await env.dispose()}
