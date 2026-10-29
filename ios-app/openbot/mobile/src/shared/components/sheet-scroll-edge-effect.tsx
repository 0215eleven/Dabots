import MaskedView from "@react-native-masked-view/masked-view";
import type { StyleProp, ViewStyle } from "react-native";
import { Platform, View } from "react-native";
import { useCSSVariable } from "uniwind";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { ProgressiveSheetBlur } from "@/shared/components/progressive-sheet-blur";
import { isIOS } from "@/shared/lib/platform";

interface SheetScrollEdgeEffectProps {
  style: StyleProp<ViewStyle>;
  edge?: "top" | "bottom";
  /** The color under the content: a sheet, or the canvas of a full screen. */
  surface?: "canvas" | "sheet";
}

/**
 * The edge where content scrolls under a bar. Sheets and full screens have the same effect: a
 * progressive blur on iOS, and on Android, which has no cheap blur, a fade into the surface color.
 */
export function SheetScrollEdgeEffect({ style, edge = "top", surface = "canvas" }: SheetScrollEdgeEffectProps) {
  const color = useCSSVariable(surface === "sheet" ? "--openbot-bg-sheet" : "--background");
  // The upstream web MaskedView renders maskElement itself; use a surface fade
  // in the browser so the native black alpha mask never covers the header.
  if (Platform.OS === "web") return <View pointerEvents="none" style={style}>
    <Svg height="100%" width="100%"><Defs><LinearGradient id="sheet-web-surface-fade" x1="0" x2="0" y1={edge === "top" ? "0" : "1"} y2={edge === "top" ? "1" : "0"}>
      <Stop offset="0" stopColor={String(color)} stopOpacity={1}/><Stop offset="0.24" stopColor={String(color)} stopOpacity={0.85}/><Stop offset="0.72" stopColor={String(color)} stopOpacity={0.19}/><Stop offset="1" stopColor={String(color)} stopOpacity={0}/>
    </LinearGradient></Defs><Rect fill="url(#sheet-web-surface-fade)" height="100%" width="100%"/></Svg>
  </View>;
  if (isIOS) return <ProgressiveSheetBlur style={style} edge={edge} surface={surface} />;

  return (
    <View pointerEvents="none" style={style}>
      <MaskedView
        style={{ flex: 1 }}
        maskElement={
          <Svg height="100%" width="100%">
            <Defs>
              <LinearGradient
                id="sheet-scroll-edge-mask"
                x1="0"
                x2="0"
                y1={edge === "top" ? "0" : "1"}
                y2={edge === "top" ? "1" : "0"}
              >
                <Stop offset="0" stopColor="#000000" stopOpacity="1" />
                <Stop offset="0.24" stopColor="#000000" stopOpacity={0.85} />
                <Stop offset="0.5" stopColor="#000000" stopOpacity={0.5} />
                <Stop offset="0.72" stopColor="#000000" stopOpacity={0.19} />
                <Stop offset="0.9" stopColor="#000000" stopOpacity={0.028} />
                <Stop offset="1" stopColor="#000000" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect fill="url(#sheet-scroll-edge-mask)" height="100%" width="100%" />
          </Svg>
        }
      >
        <View className={surface === "sheet" ? "flex-1 bg-sheet" : "flex-1 bg-background"} />
      </MaskedView>
    </View>
  );
}
