// Independent bounded image-header reader. No decoder, browser globals or original-file base64.
export interface ImageHeader {width:number;height:number;mimeType:string;orientation:number}
type Range={offset:number;length:number};
export const IMAGE_HEADER_LIMITS={span:524288,segments:256,readBytes:16384} as const;
const word=(b:Uint8Array,p:number)=>b[p]*256+b[p+1];
const uint=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset+p,4).getUint32(0);
const ascii=(b:Uint8Array,start:number,end:number)=>String.fromCharCode(...b.subarray(start,end));
function result(width:number,height:number,mimeType:string,orientation=1):ImageHeader|null{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)return null;
 return {width:orientation>=5?height:width,height:orientation>=5?width:height,mimeType,orientation};
}
function* scan(size:number):Generator<Range,ImageHeader|null,Uint8Array>{
 if(!Number.isSafeInteger(size)||size<12)return null;
 const head=yield {offset:0,length:Math.min(size,32)};
 if(head.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v)&&ascii(head,12,16)==='IHDR')return result(uint(head,16),uint(head,20),'image/png');
 if(head.length>=30&&ascii(head,0,4)==='RIFF'&&ascii(head,8,12)==='WEBP'){
  const type=ascii(head,12,16),le24=(p:number)=>head[p]+head[p+1]*256+head[p+2]*65536;
  if(type==='VP8X')return result(le24(24)+1,le24(27)+1,'image/webp');
  if(type==='VP8 ')return result((head[26]+head[27]*256)&16383,(head[28]+head[29]*256)&16383,'image/webp');
  if(type==='VP8L'){const n=(le24(21)+head[24]*16777216)>>>0;return result((n&16383)+1,((n>>>14)&16383)+1,'image/webp');}
  return null;
 }
 if(head[0]!==255||head[1]!==216)return null;
 let offset=2,width=0,height=0,orientation=1;
 const end=Math.min(size,IMAGE_HEADER_LIMITS.span);
 for(let count=0;count<IMAGE_HEADER_LIMITS.segments&&offset+4<=end;count++){
  const marker=yield {offset,length:4};if(marker.length!==4||marker[0]!==255)return null;
  const kind=marker[1];if(kind===255){offset++;continue;}
  if(kind===218||kind===217)return result(width,height,'image/jpeg',orientation);
  if(kind===216||(kind>=208&&kind<=215)){offset+=2;continue;}
  const length=word(marker,2);if(length<2||offset+2+length>size)return null;
  if(kind>=192&&kind<=207&&![196,200,204].includes(kind)){
   if(length<8||offset+9>end)return null;const sof=yield {offset:offset+4,length:5};if(sof.length!==5)return null;
   height=word(sof,1);width=word(sof,3);
  }
  if(kind===225&&length>=16&&offset+18<=end){
   const exif=yield {offset:offset+4,length:14};
   if(exif.length===14&&ascii(exif,0,6)==='Exif\0\0'){
    const little=ascii(exif,6,8)==='II',big=ascii(exif,6,8)==='MM',view=new DataView(exif.buffer,exif.byteOffset,exif.byteLength);
    if((little||big)&&view.getUint16(8,little)===42){
     const relative=view.getUint32(10,little),start=offset+10+relative,segmentEnd=offset+2+length;
     if(relative>=8&&start+2<=Math.min(segmentEnd,end)){
      const n=yield {offset:start,length:2};const entries=n.length===2?new DataView(n.buffer,n.byteOffset,2).getUint16(0,little):0;
      if(entries>0&&entries<=128&&start+2+entries*12<=Math.min(segmentEnd,end)){
       const fields=yield {offset:start+2,length:entries*12};if(fields.length!==entries*12)return null;const table=new DataView(fields.buffer,fields.byteOffset,fields.byteLength);
       for(let i=0;i<entries;i++){const at=i*12;if(table.getUint16(at,little)===274&&table.getUint16(at+2,little)===3&&table.getUint32(at+4,little)===1){const value=table.getUint16(at+8,little);if(value>=1&&value<=8)orientation=value;}}
      }
     }
    }
   }
  }
  offset+=2+length;
 }
 return width&&height&&offset<=end?result(width,height,'image/jpeg',orientation):null;
}
function allowed(range:Range,size:number,read:number){return range.offset>=0&&range.length>0&&range.offset+range.length<=size&&read+range.length<=IMAGE_HEADER_LIMITS.readBytes;}
export function imageHeader(bytes:Uint8Array):ImageHeader|null{
 const parser=scan(bytes.length);let next=parser.next(),read=0;
 while(!next.done){const range=next.value;if(!allowed(range,bytes.length,read))return null;read+=range.length;next=parser.next(bytes.subarray(range.offset,range.offset+range.length));}
 return next.value;
}
export async function readImageHeader(size:number,readAt:(offset:number,length:number)=>Promise<Uint8Array>,signal?:AbortSignal):Promise<ImageHeader|null>{
 const parser=scan(size);let next=parser.next(),read=0;
 while(!next.done){signal?.throwIfAborted();const range=next.value;if(!allowed(range,size,read))return null;read+=range.length;const bytes=await readAt(range.offset,range.length);signal?.throwIfAborted();if(bytes.length!==range.length)return null;next=parser.next(bytes);}
 return next.value;
}
