import {UploadSelectionError} from './upload-attachments';

export type PhotoSelection={uri:string;fileName?:string|null;mimeType?:string|null;width?:number;height?:number};
export type PhotoPreview={uri:string;name:string;mimeType:string;size:number;width:number;height:number};
export type PreparedPhoto={uri:string;name:string;mimeType:string;size:number;preview?:PhotoPreview;previewUnavailable?:boolean;discard?:()=>void};
export interface PhotoIO {
 inspect:(uri:string)=>Promise<{header:Uint8Array;size:number;width?:number;height?:number}>;
 encode:(uri:string,options:{format:'png'|'jpeg';maxEdge:number;quality:number})=>Promise<string>;
 discard:(uri:string)=>void;
}
function imageFormat(header:Uint8Array):'png'|'jpeg'|'webp'|'heic'|'heif'|'gif'|'avif'|null {
 if([137,80,78,71,13,10,26,10].every((value,index)=>header[index]===value))return 'png';
 if(header[0]===255&&header[1]===216&&header[2]===255)return 'jpeg';
 const text=String.fromCharCode(...header.subarray(0,16));
 if(text.startsWith('RIFF')&&text.slice(8,12)==='WEBP')return 'webp';
 if(text.startsWith('GIF87a')||text.startsWith('GIF89a'))return 'gif';
 if(text.slice(4,8)==='ftyp'){
  if(['heic','heix','hevc','hevx','heim','heis'].includes(text.slice(8,12)))return 'heic';
  if(['mif1','msf1'].includes(text.slice(8,12)))return 'heif';
  if(['avif','avis'].includes(text.slice(8,12)))return 'avif';
 }
 return null;
}
function photoName(asset:PhotoSelection,format:string){
 const extension=format==='jpeg'?'jpg':format;
 const stem=(asset.fileName??'photo').replace(/\.[^.]*$/u,'').replace(/[\p{Cc}\p{Zl}\p{Zp}/\\:]/gu,'_').replace(/^\.+|\.+$/gu,'').trim();
 return `${(stem||'photo').slice(0,240)}.${extension}`;
}
/** Original bytes are never transformed. A separately named bounded model preview is optional. */
export async function preparePhoto(asset:PhotoSelection,maxBytes:number,io:PhotoIO):Promise<PreparedPhoto>{
 const source=await io.inspect(asset.uri),format=imageFormat(source.header);
 const name=asset.fileName??'photo';
 if(!format)throw new UploadSelectionError('type',name);
 if(!Number.isSafeInteger(source.size)||source.size<=0)throw new UploadSelectionError('damaged',name);
 if(source.size>maxBytes)throw new UploadSelectionError('size',name);
 const original={uri:asset.uri,name:photoName(asset,format),mimeType:`image/${format}`,size:source.size};
 const width=source.width??asset.width,height=source.height??asset.height;
 // Unknown or excessive source dimensions do not enter a decoder. The original remains a file.
 if(source.size>20*1048576||!width||!height||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>64000000||Math.max(width,height)>8192)return {...original,previewUnavailable:true};
 const previewName=(kind:string)=>{const name=photoName(asset,kind),dot=name.lastIndexOf('.');return `Model preview - ${name.slice(0,dot).slice(0,220)}${name.slice(dot)}`;};
 if(['png','jpeg','webp'].includes(format)&&source.size<=2097152&&width*height<=4194304&&Math.max(width,height)<=2048)return {...original,preview:{uri:asset.uri,name:previewName(format),mimeType:`image/${format}`,size:source.size,width,height}};
 // PNG/WebP preview alpha is retained. HEIC/HEIF and JPEG previews are genuinely encoded JPEG.
 const outputFormat=format==='png'||format==='webp'?'png':'jpeg';
 for(const [maxEdge,quality] of [[2048,0.9],[1536,0.8],[1024,0.7],[768,0.6]] as const){
  let uri:string;
  try{uri=await io.encode(asset.uri,{format:outputFormat,maxEdge,quality});}catch{return {...original,previewUnavailable:true};}
  let kept=false;
  try{
   const output=await io.inspect(uri);
   if(imageFormat(output.header)!==outputFormat)return {...original,previewUnavailable:true};
   if(Number.isSafeInteger(output.size)&&output.size>0&&output.size<=2097152&&output.width&&output.height&&output.width*output.height<=4194304&&Math.max(output.width,output.height)<=2048){
    kept=true;return {...original,preview:{uri,name:previewName(outputFormat),mimeType:`image/${outputFormat}`,size:output.size,width:output.width,height:output.height},discard:()=>io.discard(uri)};
   }
  }finally{if(!kept)io.discard(uri);}
 }
 return {...original,previewUnavailable:true};
}
