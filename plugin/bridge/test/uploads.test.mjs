import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createUploads,UPLOAD_LIMITS,validateUpload} from '../src/uploads.mjs'
test('bounded uploads are exact-session/device capabilities, durable and cleaned after use or expiry',async t=>{
 const home=await mkdtemp(join(tmpdir(),'dabots-uploads-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const auth={data:{uploads:{}},save:async()=>{}};const store=await createUploads(home,auth);t.after(()=>store.close());
 const scope={deviceId:'phone',conversationId:'chief',sessionId:'s'};
 const value=await store.put({...scope,name:'notes.txt',mediaType:'text/plain',bytes:Buffer.from('synthetic bytes')});
 const [part]=await store.resolve([value.receiptId],scope);assert.equal(Buffer.from(part.data,'base64').toString(),'synthetic bytes');assert.equal(part.type,'file-upload');
 const restarted=await createUploads(home,auth);t.after(()=>restarted.close());
 assert.deepEqual(await restarted.resolve([value.receiptId],scope),[part]);
 await assert.rejects(store.resolve([value.receiptId],{...scope,deviceId:'other'}),{code:'UPLOAD_EXPIRED'});
 await assert.rejects(store.resolve([value.receiptId],{...scope,sessionId:'other'}),{code:'UPLOAD_EXPIRED'});
 await assert.rejects(store.resolve([value.receiptId],{...scope,conversationId:'another'}),{code:'UPLOAD_EXPIRED'});
 await assert.rejects(store.resolve([value.receiptId,value.receiptId],scope),{code:'INVALID_ATTACHMENTS'});
 for(const name of ['../a.txt','C:\\x.txt','a/b.txt','bad\0.txt','program.exe'])assert.throws(()=>validateUpload(name,'text/plain',1));
 assert.throws(()=>validateUpload('huge.txt','text/plain',UPLOAD_LIMITS.maxBytes+1));
 await store.remove(value.receiptId,scope.deviceId);assert.deepEqual(await readdir(join(home,'uploads')),[]);
 const expired=await store.put({...scope,name:'old.txt',mediaType:'text/plain',bytes:Buffer.from('old')});auth.data.uploads[expired.receiptId].expiresAt=0;await store.prune();assert.equal(auth.data.uploads[expired.receiptId],undefined);
});
test('concurrent staging enforces the per-device quota before writing bytes',async t=>{
 const home=await mkdtemp(join(tmpdir(),'dabots-upload-quota-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const auth={data:{uploads:{}},save:async()=>{}},store=await createUploads(home,auth);t.after(()=>store.close());
 const input={deviceId:'phone',conversationId:'chief',sessionId:'s',name:'synthetic.txt',mediaType:'text/plain',bytes:Buffer.from('ok')};
 const results=await Promise.allSettled(Array.from({length:20},()=>store.put(input)));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,16);
 assert.ok(results.filter(result=>result.status==='rejected').every(result=>result.reason.code==='UPLOAD_QUOTA'));
 assert.equal((await readdir(join(home,'uploads'))).length,16);
});
