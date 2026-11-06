export type PreviewMeasure=(done:(x:number,y:number,width:number,height:number)=>void)=>void;
export const viewerPreviewActive=(slot:number,shown:number)=>Math.abs(slot-shown)<=1;
/** Only entries in a viewable row are measured; delayed callbacks cannot resurrect an offscreen row. */
export function createPreviewRegion(height:number){
 let visible=false,generation=0;const entries=new Set<{measure:PreviewMeasure;notify:(visible:boolean)=>void}>();
 function scan(){const revision=++generation;for(const entry of entries){if(!visible){entry.notify(false);continue;}entry.measure((_x,y,width,h)=>{if(entries.has(entry)&&visible&&revision===generation)entry.notify(Number.isFinite(y)&&Number.isFinite(h)&&width>0&&h>0&&y<height&&y+h>0);});}}
 return {scan,setVisible:(value:boolean)=>{visible=value;scan()},setHeight:(value:number)=>{height=value;scan()},register:(measure:PreviewMeasure,notify:(visible:boolean)=>void)=>{const entry={measure,notify};entries.add(entry);scan();return()=>{entries.delete(entry);notify(false)};}};
}
