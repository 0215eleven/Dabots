// Reproducible synthetic RGBA pixels, not private screenshots or third-party image assets.
import {crc32,deflateSync} from 'node:zlib'
const chunk=(type,data)=>{const kind=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([length,kind,data,crc])}
export function portraitPixels(width=480,height=800){
 const pixels=Buffer.alloc(width*height*4);let state=1234567
 for(let i=0;i<pixels.length;i+=4){state^=state<<13;state^=state>>>17;state^=state<<5;const gray=state&255;pixels[i]=gray;pixels[i+1]=(gray+((i/4)%width))&255;pixels[i+2]=gray;pixels[i+3]=(i/4)%11===0?96:255}
 return {pixels,width,height}
}
export function portraitPng(){
 const {pixels,width,height}=portraitPixels(),rows=Buffer.alloc(height*(width*4+1)),ihdr=Buffer.alloc(13)
 for(let y=0;y<height;y++)pixels.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4)
 ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])
}
