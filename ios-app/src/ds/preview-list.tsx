import React from 'react';
import {KeyboardAwareLegendList} from '@legendapp/list/keyboard';
import {ChatPreviewViewport} from './preview-range';

/** Keep position measurements independent of Legend List's amount-only viewability events. */
export function ChatPreviewList<ItemT>(props:Parameters<typeof KeyboardAwareLegendList<ItemT>>[0]){
 return <ChatPreviewViewport>{scan=><KeyboardAwareLegendList {...props}
  onScroll={event=>{props.onScroll?.(event);scan()}}
  scrollEventThrottle={64}
  onLayout={event=>{props.onLayout?.(event);scan()}}
  onContentSizeChange={(width,height)=>{props.onContentSizeChange?.(width,height);scan()}}
 />}</ChatPreviewViewport>;
}
