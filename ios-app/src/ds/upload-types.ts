export interface LocalUploadPreview {uri:string;name:string;mimeType:string;size:number;width:number;height:number}
/** An App-owned copy, never an address pointing at the user's original document. */
export interface LocalUpload {
 uri:string;name:string;mediaType:string;size:number;clientId:string;sha256?:string;owned:true;kind:'file'|'photo';
 preview?:LocalUploadPreview;previewUnavailable?:boolean;
}
