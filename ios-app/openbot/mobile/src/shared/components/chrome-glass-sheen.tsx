import { useId } from "react";
import { StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";

/**
 * The light that falls on the top of the fallback design glass. It
 * lies over the fill, inside a parent that clips it to the shape.
 */
export function ChromeGlassSheen({ highlightOpacity }: { highlightOpacity?: number } = {}) {
  const id = `chrome-glass-sheen-${useId()}`;
  const { theme } = useUniwind();
  // Dark glass takes less light, or it reads brighter than the design.
  const light = highlightOpacity ?? (theme === "dark" ? 0.06 : 0.12);
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} height="100%" width="100%">
      <Defs>
        <LinearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={light} />
          <Stop offset="0.55" stopColor="#ffffff" stopOpacity={light / 4} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect fill={`url(#${id})`} height="100%" width="100%" />
    </Svg>
  );
}
