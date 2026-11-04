import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
const code=transformSync(readFileSync(new URL('../openbot/mobile/src/features/agents/components/office-view.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react'}}}).code;
function fixture(width=393,height=852,dark=true){
 let window={width,height,scale:1,fontScale:1},sequence=0;
 const opened:string[]=[];
 const react={memo:(f:any)=>f,useEffect:()=>{},useId:()=>`floor-${sequence++}`,
  createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}})};
 const modules:any={
  react,'react-native':{View:'View',ScrollView:'ScrollView',Pressable:'Pressable',useWindowDimensions:()=>window},
  'heroui-native':{Typography:{Paragraph:'Text'}},'heroui-native/hooks':{useThemeColor:()=>['green','orange','gray']},
  'react-native-reanimated':{__esModule:true,default:{View:'AnimatedView'},useSharedValue:(value:any)=>({get:()=>value,set:()=>{}}),useAnimatedStyle:(read:any)=>read()},
  'react-native-svg':{__esModule:true,default:'Svg',Ellipse:'Ellipse',Line:'Line',Polygon:'Polygon',Rect:'Rect',Defs:'Defs',Pattern:'Pattern'},
  uniwind:{useUniwind:()=>({theme:dark?'dark':'light'})},
  '@/features/agents/components/bloub-avatar':{BloubAvatar:'Avatar'},
  '@/features/agents/components/office-motion':{Bubble:'Bubble',ScreenCode:'ScreenCode',Seat:'Seat'},
  '@/shared/lib/haptics':{haptics:{impact:async()=>{}}},'@/shared/lib/motion':{useReducedMotion:()=>true},
  '@ds/text':{useDsText:()=>({tr:(text:string)=>text})},
 };
 const module={exports:{} as any};
 new Function('require','module','exports','React',code)((name:string)=>{if(!(name in modules))throw Error(name);return modules[name]},module,module.exports,react);
 function render(node:any):any{
  if(Array.isArray(node))return node.map(render);
  if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function')return render(node.type(node.props));
  return {...node,props:{...node.props,children:render(node.props.children)}};
 }
 return {api:module.exports,opened,resize:(width:number,height:number)=>{window={...window,width,height}},
  render:(desks=4,rooms=0,sideInsets={left:0,right:0})=>render(module.exports.OfficeView({agents:Array.from({length:desks},(_,i)=>({id:`bot-${i}`,name:`Bot ${i}`})),rooms:Array.from({length:rooms},(_,i)=>({id:`room-${i}`,name:`Room ${i}`,members:[]})),work:{},topInset:59,bottomInset:118,sideInsets,onOpenBot:(bot:any)=>opened.push(bot.id),onOpenRoom:(room:any)=>opened.push(room.id)}))};
}
function elements(node:any):any[]{return Array.isArray(node)?node.flatMap(elements):node&&typeof node==='object'?[node,...elements(node.props?.children)]:[]}
const module={exports:fixture().api};
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

test('floor covers the viewport and the whole scroll content, including safe areas and elastic overscroll',()=>{
 for(const dark of [true,false])for(const [width,height] of [[320,568],[393,852],[852,393],[1024,1366]])for(const desks of [0,4,40]){
  const f=fixture(width,height,dark),root=f.render(desks,desks===40?7:0,{left:width>height?59:0,right:width>height?59:0});
  assert.equal(root.type,'View','a stationary floor must remain behind the moving content');
  assert.equal(root.props.style.flex,1);
  assert.equal(root.props.style.backgroundColor,dark?'#1d1f24':'#eceef2');
  const scroll=elements(root).find(n=>n.type==='ScrollView');
  assert.equal(scroll.props.style.flex,1);assert.equal(scroll.props.contentContainerStyle.flexGrow,1);
  assert.equal(scroll.props.contentContainerStyle.paddingTop,59);assert.equal(scroll.props.contentContainerStyle.paddingBottom,118);
  const backdrops=elements(root).filter(n=>n.type==='View'&&n.props.pointerEvents==='none'&&n.props.style?.left===0&&n.props.style?.right===0&&n.props.style?.top===0&&n.props.style?.bottom===0);
  assert.equal(backdrops.length,2,'both viewport and translated content need a continuous floor');
  for(const backdrop of backdrops){
   const svg=elements(backdrop).find(n=>n.type==='Svg'),fill=elements(svg).find(n=>n.type==='Rect'&&n.props.fill===(dark?'#1d1f24':'#eceef2'));
   assert.equal(svg.props.width,'100%');assert.equal(svg.props.height,'100%');
   assert.equal(fill.props.width,'100%');assert.equal(fill.props.height,'100%');
  }
  // The direct viewport backdrop does not move with content, including iOS bounce.
  // These are layout contracts; native elastic physics still need device acceptance.
  assert.ok(root.props.children.some((n:any)=>backdrops.includes(n)));
 }
});

test('floor retessellates after rotation without changing desk or room actions',()=>{
 const f=fixture();let root=f.render(4,1);
 const before=elements(root).filter(n=>n.type==='Pattern');assert.equal(before.length,2);
 assert.equal(new Set(before.map(n=>n.props.id)).size,2,'SVG pattern definitions must not collide');
 const buttons=elements(root).filter(n=>n.type==='Pressable');assert.equal(buttons.length,5);
 buttons.forEach(n=>n.props.onPress());assert.deepEqual(f.opened,['room-0','bot-0','bot-1','bot-2','bot-3']);
 f.resize(852,393);root=f.render(4,1,{left:59,right:59});
 const after=elements(root).filter(n=>n.type==='Pattern');
 assert.ok(after.every(n=>n.props.width>before[0].props.width&&n.props.height>0));
 assert.equal(elements(root).filter(n=>n.type==='Pressable').length,5);
});
