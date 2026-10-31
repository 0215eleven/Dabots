import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
const code=transformSync(readFileSync(new URL('../openbot/mobile/src/features/agents/components/office-view.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}}}).code;
const module={exports:{} as any};
new Function('require','module','exports','React',code)((name:string)=>name==='react'?{memo:(f:any)=>f,useEffect:()=>{}}:new Proxy({}, {get:()=>()=>null}),module,module.exports,{createElement:()=>null});
const {officeSeats}=module.exports;

test('Bots working in a running meeting sit in that room, the others at their desks',()=>{
  const agents=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
  const rooms=[{id:'room',name:'Planning',members:[{agentId:'a'},{agentId:'b'}]},{id:'quiet',name:'Quiet',members:[{agentId:'c'}]}];
  const work={room:{phase:'working',detail:null,members:[{botId:'a',phase:'responding',detail:null}]},quiet:{phase:'idle',detail:null},b:{phase:'working',detail:'x'},c:{phase:'waiting',detail:null},d:{phase:'responding',detail:'y'}};
  const seats=officeSeats(agents,rooms,work);
  assert.equal(seats.inMeeting.get('a')?.name,'Planning','a works in the meeting');
  assert.equal(seats.inMeeting.has('b'),false,'a member not working in the meeting stays at its desk');
  assert.equal(seats.meetings,1,'an idle room is free');
  assert.equal(seats.busyDesks,2,'b and d work at their desks; waiting is not counted as busy');
});

test('rooms line the back wall two to a row, desks run down in two columns',()=>{
  const {officeLayout}=module.exports;
  const layout=officeLayout(5,3);
  assert.deepEqual(layout.rooms.map((r:any)=>[r.x,r.y,r.w]),[[0,0,3],[3,0,3],[0,4.4,6]],'an odd last room spans the wall');
  assert.deepEqual(layout.desks.map((d:any)=>d.x),[1.5,4.5,1.5,4.5,1.5]);
  assert.ok(layout.desks.every((d:any)=>d.y>6),'desks start in front of the rooms');
  assert.ok(layout.desks[2].y>layout.desks[0].y&&layout.depth>layout.desks[4].y,'each pair of desks is one row further down');
  assert.equal(officeLayout(0,0).rooms.length,0);
});
