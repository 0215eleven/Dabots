import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {transformSync}=createRequire(import.meta.url)('esbuild');
const source=readFileSync(new URL('../openbot/mobile/src/features/chat/components/image-viewer.tsx',import.meta.url),'utf8');
const hook=source.slice(source.indexOf('let knownReduceTransparency:'),source.indexOf('export interface ImageViewerPage'));
async function mount(api:any){
 let value:any,cleanup:any;const effects:any[]=[];
 const compiled=transformSync(hook,{loader:'ts',format:'cjs'}).code;
 new Function('AccessibilityInfo','useState','useEffect',compiled+'\nuseReduceTransparency();')(api,(initial:any)=>[initial,(next:any)=>{value=next}],(effect:any)=>{effects.push(effect)});
 cleanup=effects[0]();await Promise.resolve();return{value,cleanup};
}
test('viewer mounts on a web/native implementation without the optional transparency query',async()=>{
 let removed=false;const mounted=await mount({addEventListener:()=>({remove(){removed=true}})});assert.equal(mounted.value,false);mounted.cleanup();assert.equal(removed,true);
});
test('native transparency preference and failed queries retain their intended behavior',async()=>{
 for(const [query,expected] of [[()=>Promise.resolve(true),true],[()=>Promise.reject(Error('unavailable')),false]] as const){
  const mounted=await mount({isReduceTransparencyEnabled:query,addEventListener:()=>({remove(){}})});assert.equal(mounted.value,expected);mounted.cleanup();
 }
});
