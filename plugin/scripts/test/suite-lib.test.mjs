import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {composeClient,composeManifest,composePatch,engineContract,extractFactory} from '../suite-lib.mjs'

const engineClient=`// Generated
window.__ModuleLoader__.load({
  id: 'ds-bot',
  factory: (require) => {
const module = { exports: { inject: ['sessions', 'slots'], apply(ctx) { ctx.calls.push('engine:' + require('react')) } } }
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
`
const run=(source)=>{const loads=[];vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>loads.push(entry)}},console});return loads}

test('the merged client registers one ds-bot module that applies both parts', () => {
  const mobile=`module.exports={inject:['slots'],apply(ctx){ctx.calls.push('mobile')}}`
  const loads=run(composeClient({engineClient,mobileBundle:mobile}))
  assert.equal(loads.length,1); assert.equal(loads[0].id,'ds-bot')
  const module=loads[0].factory(name=>name)
  assert.deepEqual([...module.inject],['sessions','slots'])
  const ctx={calls:[]}; module.apply(ctx)
  assert.deepEqual(ctx.calls,['engine:react','mobile'])
  assert.equal(Object.prototype.toString.call(module),'[object Module]')
})

test('a failing settings UI leaves the Bot team UI applied', () => {
  const loads=run(composeClient({engineClient,mobileBundle:`module.exports={apply(){throw Error('boom')}}`}))
  const ctx={calls:[]}; const errors=[]; const original=console.error; console.error=(...args)=>errors.push(args)
  try{loads[0].factory(name=>name).apply(ctx)}finally{console.error=original}
  assert.deepEqual(ctx.calls,['engine:react']); assert.equal(errors.length,1)
})

test('only a single recognised engine registration is accepted', () => {
  assert.throws(()=>extractFactory(engineClient,'ds-bot-mobile-app'))
  assert.throws(()=>extractFactory(engineClient+engineClient,'ds-bot'))
  assert.throws(()=>extractFactory('module.exports={}','ds-bot'))
})

test('the Bridge row keeps its ID and resolves inside the package', () => {
  const enginePatch='- insert:\n    - id: bot\n      name: ds-bot\n'
  const bridgePatch='- insert:\n    - id: ds-bot-mobile-bridge\n      name: ds-bot-mobile-bridge\n      config:\n        enabled: false\n'
  const patch=composePatch({enginePatch,bridgePatch})
  assert.match(patch,/^- insert:\n    - id: bot\n      name: ds-bot\n/)
  assert.match(patch,/- id: ds-bot-mobile-bridge\n      name: ds-bot\/bridge\n      config:\n        enabled: false/)
  assert.throws(()=>composePatch({enginePatch:enginePatch+'    - id: ds-bot-mobile-bridge\n',bridgePatch}))
  assert.throws(()=>composePatch({enginePatch,bridgePatch:bridgePatch+bridgePatch}))
})

test('the engine contract is checked by capability, not by version', () => {
  assert.deepEqual(engineContract(`case 'bridge.describe': case 'bridge.submit': case "bridge.redact": case 'bridge.agent-open':`),{missing:[],agents:true})
  assert.deepEqual(engineContract(`case 'state':`).missing,['bridge.describe','bridge.submit','bridge.redact'])
})

test('the manifest keeps the engine and adds the Bridge export and dependency', () => {
  const engine={name:'ds-bot',version:'0.2.0',type:'module',exports:{'.':'./index.js','./client':'./client.js'},files:['index.js','src/host/'],peerDependencies:{'@deepseek-ai/cordis':'*'}}
  const bridge={dependencies:{ws:'8.18.3'},peerDependencies:{'@deepseek-ai/schemastery':'~3.18.5'}}
  const manifest=composeManifest({engine,bridge,version:'0.2.0-suite.1',suite:{revision:1}})
  assert.equal(manifest.name,'ds-bot'); assert.equal(manifest.version,'0.2.0-suite.1')
  assert.equal(manifest.exports['./bridge'],'./bridge/index.mjs'); assert.equal(manifest.exports['./client'],'./client.js')
  assert.deepEqual(manifest.dependencies,{ws:'8.18.3'})
  assert.ok(manifest.files.includes('bridge/'))
  assert.throws(()=>composeManifest({engine:{...engine,name:'other'},bridge,version:'x'}))
  assert.throws(()=>composeManifest({engine:{...engine,dependencies:{ws:'7.0.0'}},bridge,version:'x'}),/conflict/)
})
