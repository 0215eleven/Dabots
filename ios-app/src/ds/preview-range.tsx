import React,{createContext,useCallback,useContext,useLayoutEffect,useMemo,useRef,useState,type PropsWithChildren} from 'react';
import {useViewabilityAmount} from '@legendapp/list/react-native';
import {useWindowDimensions} from 'react-native';
import {useHistoryShown} from '@/features/chat/components/use-history-shown';
import {createPreviewRegion} from './preview-region';
const Range=createContext<ReturnType<typeof createPreviewRegion>|null>(null);
export const PREVIEW_VIEWABILITY={viewAreaCoveragePercentThreshold:0,minimumViewTime:0};
export function ChatPreviewRange({children,active=true}:PropsWithChildren<{active?:boolean}>){
 const {height}=useWindowDimensions(),history=useHistoryShown(),region=useMemo(()=>createPreviewRegion(height),[]),inView=useRef(false);
 useLayoutEffect(()=>region.setHeight(height),[height,region]);
 useViewabilityAmount(useCallback((token:{isViewable:boolean})=>{inView.current=token.isViewable;region.setVisible(active&&history&&token.isViewable)},[active,history,region]));
 useLayoutEffect(()=>region.setVisible(active&&history&&inView.current),[active,history,region]);
 return <Range value={region}>{children}</Range>;
}
type MeasureRef={current:{measureInWindow?:(done:(x:number,y:number,width:number,height:number)=>void)=>void}|null};
export function usePreviewRange(ref:MeasureRef){
 const region=useContext(Range),[visible,setVisible]=useState(region===null);
 useLayoutEffect(()=>region?.register(done=>{if(ref.current?.measureInWindow)ref.current.measureInWindow(done);else done(0,0,0,0);},setVisible),[region,ref]);
 const onLayout=useCallback(()=>region?.scan(),[region]);return{visible,onLayout};
}
