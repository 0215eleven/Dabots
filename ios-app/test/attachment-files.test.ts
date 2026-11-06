import test from 'node:test';import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOYAAAAASUVORK5CYII=','base64');
function fixture({writeOpenFails=false,abortAfterPreview}: {writeOpenFails?:boolean;abortAfterPreview?:AbortController}={}){
 const files=new Map<string,Buffer>(),handles:any[]=[],reads:number[]=[],encodes:any[]=[];let nonce=0;
 const path=(parts:any[])=>parts.map(part=>typeof part==='string'?part:part.uri).reduce((value,part)=>value?value.replace(/\/$/u,'')+'/'+part.replace(/^\//u,''):part,'');
 class Directory{uri:string;constructor(...parts:any[]){this.uri=path(parts)+'/';}create(){}list(){return [...files.keys()].filter(uri=>uri.startsWith(this.uri)).map(uri=>new File(uri))}}
 class File{uri:string;constructor(...parts:any[]){this.uri=path(parts)}get name(){return this.uri.split('/').at(-1)!}get exists(){return files.has(this.uri)}get size(){return files.get(this.uri)?.length??0}get modificationTime(){return 1}
  create(){if(files.has(this.uri))throw Error('Already exists');files.set(this.uri,Buffer.alloc(0))}
  delete(){files.delete(this.uri)}base64(){assert.fail('Original selections must not be read as full base64')}
  open(mode:string){if(mode==='w'&&writeOpenFails)throw Error('Synthetic write-open failure');const file=this;const handle={offset:0,closed:false,
   async readBytes(length:number){assert.equal(this.closed,false);reads.push(length);const bytes=files.get(file.uri)!.subarray(this.offset,this.offset+length);this.offset+=bytes.length;return Uint8Array.from(bytes)},
   async writeBytes(bytes:Uint8Array){assert.equal(this.closed,false);assert.ok(bytes.length<=262144);files.set(file.uri,Buffer.concat([files.get(file.uri)!,bytes]));this.offset+=bytes.length},close(){this.closed=true}};handles.push(handle);return handle;
  }
 }
 const mocks:any={'expo-file-system':{File,Directory,Paths:{cache:{uri:'file:///cache/'}},FileMode:{ReadOnly:'r',WriteOnly:'w'}},'expo-crypto':{getRandomBytes:(n:number)=>new Uint8Array(n).fill(++nonce)},'react-native':{Platform:{OS:'ios'}},
  'expo-image-manipulator':{SaveFormat:{PNG:'png',JPEG:'jpeg'},ImageManipulator:{manipulate:(uri:string,options:any)=>{encodes.push({uri,options});return{release(){},renderAsync:async()=>({release(){},saveAsync:async()=>{const uri='file:///cache/ImageManipulator/generated.png';files.set(uri,png);abortAfterPreview?.abort();return{uri}}})}}}}};
 function load(entry:string){const result=buildSync({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',external:Object.keys(mocks),supported:{'dynamic-import':false},logLevel:'silent'}),module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)((name:string)=>{if(!(name in mocks))throw Error(name);return mocks[name]},module,module.exports);return module.exports;}
 return {files,handles,reads,encodes,load};
}
test('shared files are copied in bounded chunks before the provider removes them; cleanup cannot delete originals',async()=>{
 const f=fixture(),api=f.load('src/ds/attachment-files.ts'),uri='file:///user/shared.txt',data=Buffer.alloc(700000,117);f.files.set(uri,data);f.files.set('file:///user/other.txt',Buffer.from('keep'));
 const source=await api.copyDraftUpload(uri,'shared.txt',100000000);
 assert.notEqual(source.uri,uri);assert.equal(source.size,data.length);assert.equal(source.sha256,createHash('sha256').update(data).digest('hex'));assert.ok(f.reads.every(n=>n<=262144));
 f.files.delete(uri);assert.deepEqual(Buffer.from(await api.readCachedChunk(source.uri,source.size,0,262144)),data.subarray(0,262144));
 api.discardDraftUpload({...source,uri:'file:///user/other.txt'});assert.ok(f.files.has('file:///user/other.txt'));
 api.discardDraftUpload(source);assert.equal(f.files.has(source.uri),false);assert.ok(f.handles.every(handle=>handle.closed));
});
test('opening a destination failure closes the granted source handle and deletes only the created copy',async()=>{
 const f=fixture({writeOpenFails:true}),api=f.load('src/ds/attachment-files.ts'),uri='file:///user/document.txt';f.files.set(uri,Buffer.from('synthetic'));
 await assert.rejects(api.copyDraftUpload(uri,'document.txt',100000000));
 assert.ok(f.files.has(uri));assert.equal(f.files.size,1);assert.ok(f.handles.every(handle=>handle.closed));
});
test('photo originals retain exact bytes and SHA while a separately bounded model preview is created',async()=>{
 const f=fixture(),api=f.load('src/ds/prepare-photo.ts'),uri='file:///ImagePicker/original.png',data=Buffer.concat([png,Buffer.alloc(3000000)]);f.files.set(uri,data);
 const selected=await api.prepareSelectedPhoto({uri,fileName:'Original.HEIC',width:1,height:1},100000000);
 assert.equal(selected.localFile.name,'Original.png');assert.equal(selected.localFile.size,data.length);assert.deepEqual(f.files.get(selected.localFile.uri),data);
 assert.equal(selected.localFile.sha256,createHash('sha256').update(data).digest('hex'));assert.notEqual(selected.localFile.preview.uri,selected.localFile.uri);assert.ok(selected.localFile.preview.size<=2097152);
 assert.ok(f.encodes.every(({options})=>options.maxWidth<=2048&&options.maxHeight<=2048));selected.discard();assert.ok(f.files.has(uri));assert.equal(f.files.size,1);
});
test('cancelling after preview save cleans both owned files and preserves the selected original',async()=>{
 const controller=new AbortController(),f=fixture({abortAfterPreview:controller}),api=f.load('src/ds/prepare-photo.ts'),uri='file:///ImagePicker/original.png';f.files.set(uri,Buffer.concat([png,Buffer.alloc(3000000)]));
 await assert.rejects(api.prepareSelectedPhoto({uri,fileName:'original.png'},100000000,controller.signal));
 assert.deepEqual([...f.files.keys()],[uri]);assert.ok(f.handles.every(handle=>handle.closed));
});
test('the phone cache rejects excessive retained drafts and released App copies free the quota',async()=>{
 const f=fixture(),api=f.load('src/ds/attachment-files.ts'),uri='file:///user/original.txt';f.files.set(uri,Buffer.from('own'));
 const copies=[];for(let i=0;i<16;i++)copies.push(await api.copyDraftUpload(uri,'file.txt',100000000));
 await assert.rejects(api.copyDraftUpload(uri,'file.txt',100000000),{reason:'quota'});
 api.discardDraftUpload(copies[0]);assert.ok((await api.copyDraftUpload(uri,'file.txt',100000000)).uri);assert.ok(f.files.has(uri));
});

test('preview reads and inspection cannot escape private cache folders or fetch remote URLs',async()=>{
 const f=fixture(),api=f.load('src/ds/attachment-files.ts');
 for(const uri of ['file:///cache/ImageManipulator/../user.txt','file:///cache/ImageManipulator/%2e%2e/user.txt','file:///cache/ImageManipulator/%broken']){
  await assert.rejects(api.readCachedChunk(uri,3,0,3));await assert.rejects(api.inspectPhotoFile(uri));
 }
 await assert.rejects(api.inspectPhotoFile('https://example.invalid/private.png'));
 assert.equal(f.handles.length,0);
});

test('missing or unsupported picker names are inspected after an owned copy and actual bytes determine the name',async()=>{
 const f=fixture(),api=f.load('src/ds/prepare-photo.ts'),uri='file:///ImagePicker/no-extension';f.files.set(uri,png);
 for(const fileName of [undefined,'photo.bin','stale.HEIC']){
  const selected=await api.prepareSelectedPhoto({uri,fileName,mimeType:'image/heic'},100000000);assert.match(selected.name,/\.png$/);assert.deepEqual(f.files.get(selected.localFile.uri),png);selected.discard();
 }
 assert.deepEqual([...f.files.keys()],[uri]);assert.ok(f.handles.every(handle=>handle.closed));
});
