import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

test('portable updater simulations pin restart admission and never restart a restored legacy release',async()=>{
 const child=spawn(process.env.PYTHON||'python3',[fileURLToPath(new URL('./deploy_policy_test.py',import.meta.url))],{stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
 child.on('error',()=>{});const [code]=await once(child,'exit');assert.equal(code,0,output);
 assert.match(output,/Ran 8 tests/);assert.match(output,/\bOK\b/);
});
