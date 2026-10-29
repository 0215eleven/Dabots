import test from 'node:test';
import assert from 'node:assert/strict';
import {saveLocalePreference} from '../src/logic/locale-preference.ts';
test('locale round trips preserve host isolation, follow modes and unrelated original preferences', async () => {
  const records = new Map<string, Record<string, unknown>>([['A/mobile-preferences', {classic:true, locale:'en'}], ['B/mobile-preferences',{locale:'system'}]]);
  const storage = {read:async(s:string,k:string)=>records.get(s+'/'+k)??null, write:async(s:string,k:string,v:unknown)=>{records.set(s+'/'+k,v as any);}};
  for(const locale of ['zh','en','host','system'] as const){await saveLocalePreference(storage,'A',locale);assert.deepEqual(records.get('A/mobile-preferences'),{classic:true,locale});assert.deepEqual(records.get('B/mobile-preferences'),{locale:'system'});}
});
test('a silent browser write failure and a strict read failure cannot report persistence', async () => {
  await assert.rejects(saveLocalePreference({read:async()=>({locale:'en'}),write:async()=>{}},'A','zh'), /could not be saved/);
  let writes=0;
  await assert.rejects(saveLocalePreference({read:async()=>{throw Error('unread');},write:async()=>{writes++;}},'A','zh'),/unread/);
  assert.equal(writes,0);
});
