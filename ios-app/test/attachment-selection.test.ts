import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
function load(entry:string,mocks:Record<string,unknown>={}) {
 const result=buildSync({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',
  external:Object.keys(mocks),supported:{'dynamic-import':false},logLevel:'silent'});
 const module={exports:{} as any};
 new Function('require','module','exports',result.outputFiles[0].text)((name:string)=>Object.hasOwn(mocks,name)?mocks[name]:require(name),module,module.exports);
 return module.exports;
}
const png=Uint8Array.from([137,80,78,71,13,10,26,10]),jpeg=Uint8Array.from([255,216,255,224]);
const webp=Uint8Array.from(Buffer.from('RIFF1234WEBP'));
const heic=Uint8Array.from([0,0,0,24,...Buffer.from('ftypheic')]);
const cap=100000000,previewCap=2097152;

test('photo names follow inspected bytes rather than stale picker filename/MIME/URI extensions',async()=>{
 const {preparePhoto}=load('src/logic/prepare-photo.ts');
 for(const [header,extension] of [[png,'png'],[jpeg,'jpg'],[webp,'webp']] as const){
  const result=await preparePhoto({uri:'file:///ImagePicker/export.jpeg',fileName:'IMG_5059.HEIC',mimeType:'image/heic'},cap,{
   inspect:async()=>({header,size:100}),encode:()=>assert.fail('under-limit supported bytes must stay intact'),discard:()=>assert.fail('original must survive'),
  });
  assert.equal(result.uri,'file:///ImagePicker/export.jpeg');assert.equal(result.name,`IMG_5059.${extension}`);
 }
});

test('unsafe photo names are normalized and unknown bytes are rejected, never renamed as images',async()=>{
 const {preparePhoto}=load('src/logic/prepare-photo.ts');
 const io={inspect:async()=>({header:png,size:100}),encode:()=>assert.fail('not needed'),discard:()=>assert.fail('original')};
 const result=await preparePhoto({uri:'file:///ImagePicker/test',fileName:'../bad:photo\n.HEIC'},cap,io);
 assert.ok(!/[\p{Cc}/\\:]/u.test(result.name));assert.ok(!result.name.startsWith('.'));assert.match(result.name,/\.png$/);
 await assert.rejects(preparePhoto({uri:'file:///fake.png',mimeType:'image/png'},cap,{...io,inspect:async()=>({size:20,header:Uint8Array.from(Buffer.from('not an image'))})}),{reason:'type'});
});

test('HEIC/JPEG and transparent PNG previews are separate from unchanged originals',async()=>{
 const {preparePhoto}=load('src/logic/prepare-photo.ts');
 for(const source of [heic,png]){
  const encoded:any[]=[],discarded:string[]=[];
  const io={inspect:async(uri:string)=>uri==='source'?{header:source,size:3000000,width:3000,height:2000}:{header:source===png?png:jpeg,size:uri==='out1'?previewCap+1:previewCap,width:1536,height:1024},
   encode:async(uri:string,options:any)=>{encoded.push({uri,...options});return 'out'+encoded.length},discard:(uri:string)=>discarded.push(uri)};
  const result=await preparePhoto({uri:'source',fileName:'photo.heic'},cap,io);
  assert.equal(encoded.length,2);assert.equal(encoded[0].format,source===png?'png':'jpeg');
  assert.ok(encoded.every(x=>x.maxEdge<=2048&&x.maxEdge>0&&x.quality>0&&x.quality<=1));
  assert.equal(result.uri,'source');assert.equal(result.size,3000000);assert.equal(result.preview.uri,'out2');assert.deepEqual(discarded,['out1']);result.discard();assert.deepEqual(discarded,['out1','out2']);
 }
});

test('wide and tall low-byte photos are converted instead of bypassing the model preview edge bound',async()=>{
 const {preparePhoto}=load('src/logic/prepare-photo.ts');
 for(const [width,height] of [[4096,512],[512,4096]]){
  let encodes=0;
  const result=await preparePhoto({uri:'source',fileName:'panorama.png'},cap,{
   inspect:async(uri:string)=>({header:png,size:100,width:uri==='source'?width:2048,height:uri==='source'?height:256}),
   encode:async()=>{encodes++;return 'preview'},discard:()=>{},
  });
  assert.equal(encodes,1);assert.equal(result.preview.uri,'preview');assert.ok(Math.max(result.preview.width,result.preview.height)<=2048);
 }
});

test('conversion failure stays within 4 attempts and cleans every rejected output without touching the original',async()=>{
 const {preparePhoto}=load('src/logic/prepare-photo.ts');let attempts=0;const discarded:string[]=[];
 const original=await preparePhoto({uri:'original',fileName:'big.png'},cap,{inspect:async()=>({header:png,size:3000000,width:3000,height:2000}),
  encode:async()=>`out${++attempts}`,discard:(uri:string)=>discarded.push(uri)});
 assert.equal(original.uri,'original');assert.equal(original.preview,undefined);assert.equal(original.previewUnavailable,true);
 assert.equal(attempts,4);assert.deepEqual(discarded,['out1','out2','out3','out4']);
 const mismatch=await preparePhoto({uri:'original'},cap,{inspect:async(uri:string)=>({header:uri==='original'?heic:png,size:100,width:100,height:100}),
  encode:async()=> 'wrong-format',discard:(uri:string)=>discarded.push(uri)});
 assert.equal(mismatch.preview,undefined);
 assert.equal(discarded.at(-1),'wrong-format');
});

test('upload validation failures are localized with exact live limits in English and Chinese',()=>{
 const {selectionErrorMessage}=load('src/ds/attachment-selection-error.ts');
 const {UploadSelectionError}=load('src/logic/upload-attachments.ts');
 const mobile=load('openbot/packages/i18n/src/mobile.ts');
 for(const locale of ['en','zh']){
  const text={t:mobile.mobileTranslateFor(locale),format:mobile.createFormat(locale)};
  const size=selectionErrorMessage(new UploadSelectionError('size','IMG_5059.png'),text);
  assert.match(size,/100 MB/);assert.ok(!size.includes('10 MB'));
  const types=selectionErrorMessage(new UploadSelectionError('type','photo.gif'),text);
  assert.match(types,/PNG/);assert.match(types,/photo.gif/);if(locale==='zh')assert.match(types,/请选择/);
  const total=selectionErrorMessage(new UploadSelectionError('total'),text);assert.match(total,/100 MB/);
 }
});
test('100 MB original and excessive pixels stay intact without entering a decoder; one extra byte is refused',async()=>{
 const {preparePhoto}=load('src/logic/prepare-photo.ts');
 const io={inspect:async()=>({header:png,size:100000000,width:9000,height:2}),encode:()=>assert.fail('unsafe pixel bounds must not decode'),discard:()=>assert.fail('original')};
 const original=await preparePhoto({uri:'original',fileName:'photo.png'},cap,io);assert.equal(original.uri,'original');assert.equal(original.size,cap);assert.equal(original.previewUnavailable,true);
 await assert.rejects(preparePhoto({uri:'original'},cap,{...io,inspect:async()=>({header:png,size:cap+1,width:1,height:1})}),{reason:'size'});
});
test('a long original display name cannot truncate the preview extension or falsify its MIME',async()=>{
 const {preparePhoto}=load('src/logic/prepare-photo.ts');const result=await preparePhoto({uri:'original',fileName:'a'.repeat(300)+'.png'},cap,{inspect:async()=>({header:png,size:100,width:1,height:1}),encode:()=>assert.fail('small image'),discard:()=>{}});
 assert.match(result.preview.name,/\.png$/);assert.ok(result.preview.name.length<=255);
});

test('an encoder refusal retries smaller candidates; cancel and unknown HEIC dimensions never lose the original',async()=>{
 const {preparePhoto}=load('src/logic/prepare-photo.ts');let attempts=0;const discarded:string[]=[];
 const io={inspect:async(uri:string)=>({header:uri==='original'?heic:jpeg,size:100000,width:1000,height:800}),encode:async()=>{if(++attempts===1)throw Error('native encoder refused');return 'derived'},discard:(uri:string)=>discarded.push(uri)};
 const result=await preparePhoto({uri:'original',fileName:'photo.HEIC'},cap,io);assert.equal(attempts,2);assert.equal(result.preview.uri,'derived');assert.equal(result.uri,'original');result.discard();assert.deepEqual(discarded,['derived']);
 const unknown=await preparePhoto({uri:'original'},cap,{...io,inspect:async()=>({header:heic,size:343000}),encode:()=>assert.fail('unknown dimensions cannot decode')});assert.equal(unknown.previewUnavailable,true);
 const controller=new AbortController();await assert.rejects(preparePhoto({uri:'original'},cap,{...io,signal:controller.signal,encode:async()=>{controller.abort();return 'cancelled'}}),{name:'AbortError'});assert.ok(discarded.includes('cancelled'));assert.ok(!discarded.includes('original'));
});
