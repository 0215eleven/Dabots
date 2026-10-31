import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{buildSync}=require('esbuild');
const entry=fileURLToPath(new URL('../openbot/mobile/src/features/agents/model/avatar-candidates.ts',import.meta.url));
const brand=fileURLToPath(new URL('../openbot/packages/brand/src/bloub-avatar.ts',import.meta.url));
const {outputFiles}=buildSync({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',alias:{'@openbot/brand/bloub-avatar':brand},logLevel:'silent'});
const module={exports:{} as any};new Function('require','module','exports',outputFiles[0].text)(require,module,module.exports);
const {createAvatarCandidates,isStorableAvatarSeed}=module.exports;
// The Bridge's create-bot/update-bot avatar shape rule (plugin/bridge/src/actions.mjs).
const bridgeAccepts=(shape:string)=>shape.length<=32&&/^[a-z][a-z0-9-]*$/.test(shape);

test('every face the picker offers can be saved by the Bridge',()=>{
  for(const seed of ['ds-bot','Ds Bot:avatar:0:1','研究助手','x'.repeat(80)]){
    let candidates=createAvatarCandidates(seed);
    for(let batch=0;batch<4;batch++){
      assert.equal(candidates.seeds.length,12);
      assert.equal(new Set(candidates.seeds).size,12,'faces are distinct');
      for(const face of candidates.seeds.slice(1))assert.ok(bridgeAccepts(face)&&isStorableAvatarSeed(face),`${face} is storable`);
      candidates=createAvatarCandidates(seed,candidates);
    }
  }
  assert.equal(createAvatarCandidates('ds-bot').seeds[0],'ds-bot','the current face stays first');
});
