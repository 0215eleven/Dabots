import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createUploadTransfers, TRANSFER_LIMITS } from '../src/upload-transfers.mjs'

const scope={deviceId:'phone',conversationId:'bot',sessionId:'session'}
const metadata={clientId:'source-1',name:'synthetic.txt',mediaType:'text/plain',size:3,kind:'file'}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'dabots-transfer-')),auth={data:{},save:async()=>{}};let now=1000
 const make=()=>createUploadTransfers({home,auth,now:()=>now});const store=await make()
 t.after(async()=>{await store.close();await rm(home,{recursive:true,force:true})})
 return {store,auth,home,make,advance:ms=>{now+=ms}}
}
test('durable offsets, duplicate acknowledgements and exact-session file streams',async t=>{
 const {store}=await fixture(t),opened=await store.begin(scope,metadata)
 await assert.rejects(store.write(opened.id,scope,1,Buffer.from('b')),{code:'OFFSET_CONFLICT'})
 assert.equal((await store.write(opened.id,scope,0,Buffer.from('ab'))).offset,2)
 assert.equal((await store.write(opened.id,scope,0,Buffer.from('ab'))).offset,2)
 await assert.rejects(store.write(opened.id,scope,0,Buffer.from('zz')),{code:'CHUNK_CONFLICT'})
 await store.write(opened.id,scope,2,Buffer.from('c'))
 const receipt=await store.complete(opened.id,scope,sha('abc'))
 assert.equal(receipt.size,3);assert.equal(receipt.sha256,sha('abc'))
 assert.deepEqual(await store.complete(opened.id,scope,sha('abc')),receipt)
 await assert.rejects(store.status(opened.id,{deviceId:'other'}),{code:'UPLOAD_EXPIRED'})
 await assert.rejects(store.resolve([opened.id],{...scope,sessionId:'different'}),{code:'UPLOAD_EXPIRED'})
 const [file]=await store.resolve([opened.id],scope);let text='';for await(const chunk of file.stream())text+=chunk
 assert.equal(text,'abc');assert.equal(file.type,'stream-file')
 await store.remove(opened.id,scope);await assert.rejects(store.status(opened.id,scope))
})
test('declared size, chunk size, empty input, canonical digest and type boundaries fail closed',async t=>{
 const {store}=await fixture(t)
 for(const size of [0,-1,100000001,1.1])await assert.rejects(store.begin(scope,{...metadata,size}))
 const {id}=await store.begin(scope,metadata)
 await assert.rejects(store.write(id,scope,0,Buffer.alloc(TRANSFER_LIMITS.chunkBytes+1)),{code:'INVALID_CHUNK'})
 await assert.rejects(store.write(id,scope,0,Buffer.alloc(4)),{code:'INVALID_CHUNK'})
 await assert.rejects(store.complete(id,scope,sha('abc')),{code:'UPLOAD_INCOMPLETE'})
 await store.write(id,scope,0,Buffer.from('abc'))
 await assert.rejects(store.complete(id,scope,'f'.repeat(64)),{code:'DIGEST_MISMATCH'})
 await store.complete(id,scope,sha('abc'))
 await assert.rejects(store.begin(scope,{...metadata,clientId:'bad',name:'../x.txt'}))
 await assert.rejects(store.begin(scope,{...metadata,clientId:'bad',name:'x.exe'}))
})
test('resumption is idempotent but metadata changes and concurrent quota races are rejected',async t=>{
 const {store}=await fixture(t),a=await store.begin(scope,metadata)
 await store.write(a.id,scope,0,Buffer.from('a'))
 assert.equal((await store.begin(scope,metadata)).offset,1)
 await assert.rejects(store.begin(scope,{...metadata,size:4}),{code:'UPLOAD_CONFLICT'})
 const results=await Promise.allSettled([store.begin(scope,{...metadata,clientId:'two'}),store.begin(scope,{...metadata,clientId:'three'})])
 assert.ok(results.every(x=>x.status==='rejected'&&x.reason.code==='UPLOAD_BUSY'))
 await store.remove(a.id,scope)
 assert.equal((await store.begin(scope,{...metadata,clientId:'two'})).offset,0)
})
test('partial expiry and restart recovery keep file ownership and release reservations',async t=>{
 const f=await fixture(t),a=await f.store.begin(scope,metadata)
 await f.store.write(a.id,scope,0,Buffer.from('a'));await f.store.close()
 const restored=await f.make();t.after(()=>restored.close())
 assert.equal((await restored.status(a.id,scope)).offset,1)
 f.advance(TRANSFER_LIMITS.idleMs+1);await restored.prune()
 assert.deepEqual(await readdir(join(f.home,'upload-transfers')),[])
 assert.equal(Object.keys(f.auth.data.transfers).length,0)
})
test('100,000,000 original bytes are written and hashed in bounded chunks without whole-file collection',async t=>{
 const {store}=await fixture(t),size=100000000,opened=await store.begin(scope,{...metadata,size}),hash=createHash('sha256')
 for(let offset=0;offset<size;){const data=Buffer.alloc(Math.min(TRANSFER_LIMITS.chunkBytes,size-offset),offset%251);hash.update(data);offset=(await store.write(opened.id,scope,offset,data)).offset}
 const expected=hash.digest('hex'),receipt=await store.complete(opened.id,scope,expected)
 assert.equal(receipt.size,size);assert.equal(receipt.sha256,expected)
 let read=0;const verified=createHash('sha256');for await(const chunk of (await store.resolve([opened.id],scope))[0].stream()){assert.ok(chunk.length<=65536);read+=chunk.length;verified.update(chunk)}
 assert.equal(read,size);assert.equal(verified.digest('hex'),expected)
})
test('one scoped preview is immutable once the original receipt is bound for submission',async t=>{
 const {store}=await fixture(t)
 const original=await store.begin(scope,{...metadata,kind:'photo',name:'original.png',mediaType:'image/png'})
 await store.write(original.id,scope,0,Buffer.from('abc'));await store.complete(original.id,scope,sha('abc'))
 await store.resolve([original.id],scope)
 await assert.rejects(store.begin(scope,{...metadata,clientId:'preview',kind:'preview',name:'preview.png',mediaType:'image/png',previewFor:original.id}),{code:'UPLOAD_BOUND'})
})
test('declared byte reservations enforce per-device and global disk quotas before any new write',async t=>{
 const f=await fixture(t)
 for(let i=0;i<10;i++){const id=`${String(i).padStart(8,'0')}-0000-4000-8000-000000000001`;f.auth.data.transfers[id]={id,deviceId:'other_'+i,size:100000000,state:'complete',expiresAt:9999999}}
 await assert.rejects(f.store.begin(scope,metadata),{code:'UPLOAD_QUOTA'})
 for(const id of Object.keys(f.auth.data.transfers))delete f.auth.data.transfers[id]
 for(let i=0;i<2;i++){const id=`${String(i).padStart(8,'0')}-0000-4000-8000-000000000001`;f.auth.data.transfers[id]={id,deviceId:scope.deviceId,size:100000000,state:'complete',expiresAt:9999999}}
 await assert.rejects(f.store.begin(scope,metadata),{code:'UPLOAD_QUOTA'});assert.deepEqual(await readdir(join(f.home,'upload-transfers')),[])
})
