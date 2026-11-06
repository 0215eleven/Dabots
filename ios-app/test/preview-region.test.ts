import test from 'node:test';import assert from 'node:assert/strict';import {createPreviewRegion} from '../src/ds/preview-region.ts';
test('multi-image rows admit only image frames intersecting the viewport, including partial images',()=>{
 const region=createPreviewRegion(800),states:boolean[][]=[[],[],[]];let reads=0;
 for(const [index,y] of [-40,300,900].entries())region.register(done=>{reads++;done(0,y,100,100)},value=>states[index].push(value));assert.equal(reads,0);region.setVisible(true);assert.deepEqual(states.map(values=>values.at(-1)),[true,true,false]);
 region.setHeight(1000);assert.equal(states[2].at(-1),true);region.setVisible(false);assert.ok(states.every(values=>values.at(-1)===false));
});
test('delayed measurements cannot reactivate a scrolled-away or unmounted preview',()=>{
 const region=createPreviewRegion(800),callbacks:Array<(x:number,y:number,w:number,h:number)=>void>=[],states:boolean[]=[];const remove=region.register(done=>callbacks.push(done),value=>states.push(value));region.setVisible(true);region.setVisible(false);callbacks.splice(0).forEach(done=>done(0,20,100,100));assert.equal(states.at(-1),false);
 region.setVisible(true);remove();const count=states.length;callbacks.splice(0).forEach(done=>done(0,20,100,100));assert.equal(states.length,count);
});
