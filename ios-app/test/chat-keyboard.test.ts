import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {transformSync}=createRequire(import.meta.url)('esbuild');

// Execute both real motion hooks. Only React/native scheduling and event sources
// are simulated; no keyboard reducer or production event handler is copied here.
function fixture(path:string,initial?:{screenY:number;height:number},os='ios'){
 let cursor=0,handlers:any,metrics=initial,window={width:390,height:844},offset=24;
 const slots:any[]=[],effects:Array<()=>void>=[],cleanups:Array<()=>void>=[],listeners=new Map<string,Set<(e:any)=>void>>();
 const on=(name:string,fn:(e:any)=>void)=>{let set=listeners.get(name);if(!set)listeners.set(name,set=new Set());set.add(fn);return{remove:()=>set!.delete(fn)}};
 const react:any={useRef(initial:any){const n=cursor++;return slots[n]??={current:initial}},useState(initial:any){const slot=react.useRef(typeof initial==='function'?initial():initial);return[slot.current,(value:any)=>{slot.current=typeof value==='function'?value(slot.current):value}]},useCallback:(fn:any)=>fn,useMemo:(fn:any)=>fn(),useEffect(fn:()=>void){effects.push(fn)},useLayoutEffect(){}};
 const shared=(initial:any)=>{const slot=react.useRef(initial);return{get:()=>slot.current,set:(value:any)=>{slot.current=typeof value==='function'?value(slot.current):value}}};
 const mocks:any={react,'react-native':{Platform:{OS:os},Dimensions:{get:()=>window,addEventListener:(_name:string,fn:any)=>on('dimensions',fn)},Keyboard:{metrics:()=>metrics,addListener:on}},'react-native-keyboard-controller':{useKeyboardHandler:(value:any)=>{handlers=value}},'react-native-reanimated':{useSharedValue:shared,useAnimatedStyle:(read:any)=>({read}),useAnimatedReaction(){},cancelAnimation(){},withTiming:(value:any)=>value,withSpring:(value:any)=>value,ReduceMotion:{System:0},Easing:{out:()=>0,cubic:0}},'react-native-worklets':{scheduleOnRN:(fn:any,...args:any[])=>fn(...args)},'@legacy/shared/lib/motion':{useReducedMotion:()=>false},'@/shared/lib/motion':{useReducedMotion:()=>false},'@legacy/shared/lib/platform':{isAndroid:os==='android'},'@/shared/lib/platform':{isAndroid:os==='android'},'../model/chat-layout':{chatContentIsVisible:()=>true}};
 function load(file:string){const source=readFileSync(new URL(file,import.meta.url),'utf8'),code=transformSync(source,{loader:'ts',format:'cjs'}).code,module={exports:{} as any};new Function('require','module','exports',code)((name:string)=>{if(name==='@ds/use-chat-keyboard')return load('../src/ds/use-chat-keyboard.ts');if(!(name in mocks))throw Error('Unexpected dependency '+name);return mocks[name]},module,module.exports);return module.exports}
 const useMotion=load(path).useChatMotion;let motion:any;
 const render=()=>{cursor=0;motion=useMotion(103,offset,false,false,null)};
 render();for(const effect of effects){const cleanup=effect();if(typeof cleanup==='function')cleanups.push(cleanup)}
 const emit=(name:string,frame?:{screenY:number;height:number})=>{if(name==='keyboardDidHide')metrics=undefined;else if(frame)metrics=frame;for(const fn of listeners.get(name)??[])fn({endCoordinates:frame,duration:250})};
 const event=(height:number,progress=height>0?1:0)=>({height,progress,duration:250,target:1});
 return{start:(h:number)=>handlers.onStart(event(h)),move:(h:number,p=1)=>handlers.onMove(event(h,p)),end:(h:number,p=h>0?1:0)=>handlers.onEnd(event(h,p)),drag:(h:number,p:number)=>handlers.onInteractive(event(h,p)),emit,height:()=>motion.keyboardHeight.get(),progress:()=>motion.keyboardProgress.get(),lift:()=>-motion.composerStyle.read().transform[0].translateY,rotate:(height:number,nextOffset:number)=>{window={width:844,height};offset=nextOffset;for(const fn of listeners.get('dimensions')??[])fn({window});render()},dispose:()=>cleanups.forEach(fn=>fn()),listeners:()=>[...listeners.values()].reduce((n,set)=>n+set.size,0)};
}
for(const path of ['../openbot/mobile/src/features/chat/components/use-chat-motion.ts','../src/openbot/features/chat/components/use-chat-motion.ts']){
 const label=path.includes('mobile/')?'Bot/group':'DSH Agent';
 test(`${label}: first third-party opening reconciles actual height and ignores the controller's cached end`,()=>{
  const f=fixture(path);try{f.start(260);f.move(260);f.end(260);f.emit('keyboardDidShow',{screenY:448,height:396});assert.equal(f.height(),396);assert.equal(f.lift(),372);f.end(260);assert.equal(f.height(),396);f.emit('keyboardDidChangeFrame',{screenY:404,height:440});assert.equal(f.height(),440);assert.equal(f.progress(),1)}finally{f.dispose()}
 });
 test(`${label}: mounted above an already visible keyboard; rotation and safe area use current geometry`,()=>{
  const f=fixture(path,{screenY:448,height:396});try{assert.equal(f.lift(),372);f.rotate(390,11);f.emit('keyboardDidChangeFrame',{screenY:174,height:216});assert.equal(f.lift(),205);assert.equal(390-21-f.lift(),164,'composer bottom stays ten points above the keyboard')}finally{f.dispose()}assert.equal(f.listeners(),0)
 });
 test(`${label}: dismissal, stale frames, hardware keyboard and the next opening do not retain old space`,()=>{
  const f=fixture(path);try{f.start(396);f.move(396);f.end(396);f.start(0);f.move(200,0.5);assert.equal(f.height(),0);f.emit('keyboardDidHide');f.emit('keyboardDidChangeFrame',{screenY:844,height:396});assert.equal(f.height(),0);f.start(396);f.move(396);f.end(396);f.emit('keyboardDidShow',{screenY:448,height:396});assert.equal(f.lift(),372);f.drag(200,0.5);assert.equal(f.height(),200);f.start(0);f.emit('keyboardDidHide');f.emit('keyboardDidShow',{screenY:844,height:0});assert.equal(f.lift(),0)}finally{f.dispose()}
 });
 test(`${label}: Android keeps controller coordinates when adjustResize shrinks the window`,()=>{
  const f=fixture(path,undefined,'android');try{f.start(300);f.move(300);f.end(300);f.rotate(544,0);f.emit('keyboardDidShow',{screenY:544,height:300});assert.equal(f.height(),300)}finally{f.dispose()}
 });
 test(`${label}: changing IME/candidate heights, floating and invalid frames do not assume one keyboard size`,()=>{
  const f=fixture(path);try{f.start(260);for(const height of [260,396,440,216]){f.emit('keyboardDidChangeFrame',{screenY:844-height,height});assert.equal(f.lift(),height-24)}f.emit('keyboardDidChangeFrame',{screenY:Number.NaN,height:900});assert.equal(f.height(),216);f.emit('keyboardDidChangeFrame',{screenY:200,height:300});assert.equal(f.height(),0);f.rotate(844,0);f.emit('keyboardDidShow',{screenY:448,height:396});assert.equal(f.lift(),396,'a phone without a bottom safe area uses the same measured frame')}finally{f.dispose()}
 });
}
