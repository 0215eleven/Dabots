import test from 'node:test';import assert from 'node:assert/strict';
import {imageHeader,readImageHeader,IMAGE_HEADER_LIMITS} from '../src/logic/image-header.ts';
function segment(kind:number,data:Buffer){const head=Buffer.from([255,kind,0,0]);head.writeUInt16BE(data.length+2,2);return Buffer.concat([head,data]);}
function jpeg(orientation:number,metadata=3){
 const exif=Buffer.alloc(32);exif.write('Exif\0\0II',0,'binary');exif.writeUInt16LE(42,8);exif.writeUInt32LE(8,10);exif.writeUInt16LE(1,14);exif.writeUInt16LE(274,16);exif.writeUInt16LE(3,18);exif.writeUInt32LE(1,20);exif.writeUInt16LE(orientation,24);
 const sof=Buffer.from([8,4,0,6,0,3,1,17,0,2,17,0,3,17,0]);
 return Buffer.concat([Buffer.from([255,216]),segment(225,exif),...Array.from({length:metadata},()=>segment(226,Buffer.alloc(60000))),segment(194,sof),Buffer.from([255,218,0,2])]);
}
test('progressive JPEG metadata is skipped by offsets and EXIF 6/8 reserves its displayed shape',async()=>{
 for(const orientation of [1,6,8]){const bytes=jpeg(orientation),reads:any[]=[];
  const result=await readImageHeader(bytes.length,async(offset,length)=>{reads.push({offset,length});return bytes.subarray(offset,offset+length)});
  assert.deepEqual(result,{width:orientation===1?1536:1024,height:orientation===1?1024:1536,mimeType:'image/jpeg',orientation});
  assert.ok(reads.some(r=>r.offset>120000));assert.ok(reads.reduce((sum,r)=>sum+r.length,0)<1024);assert.ok(reads.every(r=>r.length<=1536));
 }
});
test('header work is bounded for overlong metadata, invalid segments, truncated reads and cancellation',async()=>{
 assert.equal(imageHeader(jpeg(1,10)),null);assert.equal(imageHeader(Buffer.from([255,216,255,225,0,1,...Buffer.alloc(30)])),null);
 let calls=0;assert.equal(await readImageHeader(100000000,async(_offset,length)=>{calls++;return new Uint8Array(length-1)}),null);assert.equal(calls,1);
 const controller=new AbortController();controller.abort();await assert.rejects(readImageHeader(100000000,async()=>assert.fail('cancelled read'),controller.signal),{name:'AbortError'});
 assert.equal(IMAGE_HEADER_LIMITS.readBytes,16384);assert.equal(IMAGE_HEADER_LIMITS.span,524288);
});
test('PNG shape comes from bytes regardless of filename and rejects zero dimensions',()=>{
 const bytes=Buffer.alloc(330000);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(942,16);bytes.writeUInt32BE(1536,20);bytes[25]=6;
 assert.deepEqual(imageHeader(bytes),{width:942,height:1536,mimeType:'image/png',orientation:1});bytes.writeUInt32BE(0,16);assert.equal(imageHeader(bytes),null);
});
