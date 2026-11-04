import {useEffect} from 'react';
import {Dimensions,Keyboard,Platform,type KeyboardMetrics} from 'react-native';
import {useKeyboardHandler} from 'react-native-keyboard-controller';
import {cancelAnimation,Easing,ReduceMotion,useSharedValue,withTiming} from 'react-native-reanimated';

// Keyboard frames are window coordinates on iOS. A hidden keyboard can retain
// its full height with its top below the window; height alone is not overlap.
function overlap(frame:KeyboardMetrics|null|undefined){
 const window=Dimensions.get('window');
 if(!frame||!Number.isFinite(frame.height)||!Number.isFinite(frame.screenY)||frame.height<0)return undefined;
 if(frame.screenY+frame.height<window.height)return 0; // floating, above the bottom dock
 return Math.max(0,Math.min(frame.height,window.height-frame.screenY));
}

/** Shared by Bot/group and classic Agent chats; no assumed IME height or delay. */
export function useChatKeyboard(){
 const initial=Platform.OS==='ios'?overlap(Keyboard.metrics())??0:0;
 const keyboardHeight=useSharedValue(initial),keyboardProgress=useSharedValue(initial>0?1:0);
 const dismissed=useSharedValue(false),settled=useSharedValue(initial>0?initial:-1);
 useKeyboardHandler({
  onStart:event=>{
   'worklet';
   cancelAnimation(keyboardHeight);cancelAnimation(keyboardProgress);
   dismissed.set(event.height<=0);settled.set(-1);
   if(event.height<=0){
    // An interrupted dismissal may omit its last frame. Continue the return
    // using the native duration while refusing stale move frames.
    const timing={duration:Math.max(0,event.duration),easing:Easing.out(Easing.cubic),reduceMotion:ReduceMotion.System};
    keyboardHeight.set(withTiming(0,timing));keyboardProgress.set(withTiming(0,timing));
   }
  },
  onMove:event=>{
   'worklet';
   if(dismissed.get()||settled.get()>=0)return;
   keyboardHeight.set(event.progress===0?0:event.height);keyboardProgress.set(event.progress);
  },
  onInteractive:event=>{
   'worklet';
   if(dismissed.get())return;
   settled.set(-1);
   keyboardHeight.set(event.progress===0?0:event.height);keyboardProgress.set(event.progress);
  },
  onEnd:event=>{
   'worklet';
   // The controller can complete using its cached will-show height after iOS
   // has already confirmed a taller third-party keyboard. Keep the real frame.
   if(settled.get()>=0){keyboardHeight.set(settled.get());keyboardProgress.set(settled.get()>0?1:0);return;}
   if(event.height<=0||event.progress===0){dismissed.set(true);keyboardHeight.set(0);keyboardProgress.set(0);}
   else if(!dismissed.get()){keyboardHeight.set(event.height);keyboardProgress.set(event.progress);}
  },
 },[keyboardHeight,keyboardProgress,dismissed,settled]);
 useEffect(()=>{
  const apply=(height:number)=>{
   cancelAnimation(keyboardHeight);cancelAnimation(keyboardProgress);
   settled.set(height);dismissed.set(height===0);keyboardHeight.set(height);keyboardProgress.set(height>0?1:0);
  };
  const subscriptions=[Keyboard.addListener('keyboardDidHide',()=>apply(0))];
  if(Platform.OS==='ios'){
   // The controller's iOS end event is scheduled from keyboardWillShow. Use
   // actual did-show/frame notifications for first-load IMEs and height changes.
   const confirm=(frame:KeyboardMetrics|null|undefined)=>{const height=overlap(frame);if(height!==undefined)apply(height)};
   subscriptions.push(Keyboard.addListener('keyboardDidShow',event=>confirm(event.endCoordinates)),Keyboard.addListener('keyboardDidChangeFrame',event=>confirm(event.endCoordinates)));
   subscriptions.push(Dimensions.addEventListener('change',()=>confirm(Keyboard.metrics())));
   confirm(Keyboard.metrics()); // navigation can mount a chat with the keyboard already up
  }
  return()=>subscriptions.forEach(subscription=>subscription.remove());
 },[keyboardHeight,keyboardProgress,dismissed,settled]);
 return{keyboardHeight,keyboardProgress};
}
