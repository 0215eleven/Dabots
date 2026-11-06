import React,{createContext,useCallback,useContext,useLayoutEffect,useMemo,useRef,useState,type PropsWithChildren,type ReactNode} from 'react';
import {useViewabilityAmount} from '@legendapp/list/react-native';
import {useWindowDimensions} from 'react-native';
import {useHistoryShown} from '@/features/chat/components/use-history-shown';
import {createPreviewRegion,createPreviewViewport} from './preview-region';
const Range=createContext<ReturnType<typeof createPreviewRegion>|null>(null);
const Viewport=createContext<ReturnType<typeof createPreviewViewport>|null>(null);
export function ChatPreviewViewport({children}:{children:(onScroll:()=>void)=>ReactNode}){
 const viewport=useMemo(()=>createPreviewViewport(),[]);
 useLayoutEffect(()=>()=>viewport.dispose(),[viewport]);
 return <Viewport value={viewport}>{children(viewport.onScroll)}</Viewport>;
}
export const PREVIEW_VIEWABILITY={viewAreaCoveragePercentThreshold:0,minimumViewTime:0};
export function ChatPreviewRange({children,active=true}:PropsWithChildren<{active?:boolean}>){
 const {height}=useWindowDimensions(),history=useHistoryShown(),region=useMemo(()=>createPreviewRegion(height),[]),inView=useRef(false),viewport=useContext(Viewport);
 useLayoutEffect(()=>viewport?.subscribe(region.scan),[viewport,region]);
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
