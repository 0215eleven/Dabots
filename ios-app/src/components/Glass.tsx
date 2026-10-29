import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../theme";

// iOS 26 renders system Liquid Glass; earlier iOS and the browser preview use a
// material blur; Android draws a translucent panel (its blur is experimental).
const liquid = Platform.OS === "ios" && isLiquidGlassAvailable();

export function Glass({ radius, style, children, ...props }: ViewProps & {
  radius: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  if (liquid) return <GlassView {...props} glassEffectStyle="regular" colorScheme={t.dark ? "dark" : "light"}
    style={[{ borderRadius: radius }, style]}>{children}</GlassView>;
  // The shadow sits on an unclipped outer view; only the material layer is clipped.
  return <View {...props} style={[{ borderRadius: radius, boxShadow: t.glassShadow }, style]}>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: t.glassEdge }]}>
      {Platform.OS === "android"
        ? <View style={[StyleSheet.absoluteFill, { backgroundColor: t.surface, opacity: 0.94 }]} />
        : <BlurView intensity={Platform.OS === "web" ? 40 : 70} tint={Platform.OS === "web" ? (t.dark ? "dark" : "light") : t.dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.glassFill }]} />
    </View>
    {children}
  </View>;
}

// A soft accent light behind the top of a page, so glass chrome has something to refract.
export function AmbientGlow({ height = 420, behindTop = 0 }: { height?: number; behindTop?: number }) {
  const t = useTheme();
  // Dark mode stays pure black.
  if (t.dark) return null;
  // behindTop extends the light under the status bar so it has no hard top edge.
  return <View pointerEvents="none" style={{ position: "absolute", top: -behindTop, left: 0, right: 0, height: height + behindTop }}>
    <Svg width="100%" height="100%">
      <Defs>
        <RadialGradient id="glowA" cx="18%" cy="8%" rx="70%" ry="60%">
          <Stop offset="0" stopColor={t.accent} stopOpacity={t.dark ? 0.32 : 0.22} />
          <Stop offset="1" stopColor={t.accent} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="glowB" cx="92%" cy="0%" rx="55%" ry="45%">
          <Stop offset="0" stopColor="#8B5CF6" stopOpacity={t.dark ? 0.22 : 0.12} />
          <Stop offset="1" stopColor="#8B5CF6" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#glowA)" />
      <Rect width="100%" height="100%" fill="url(#glowB)" />
    </Svg>
  </View>;
}

/** Fades scrolled content into the page colour where it passes under floating
 * chrome (the tab bar, a floating header), instead of a hard cut-off line. */
export function EdgeFade({ edge, height }: { edge: "top" | "bottom"; height: number }) {
  const t = useTheme();
  const id = `fade-${edge}-${React.useId().replace(/:/g, "")}`;
  // Opacity from the top of the band to its bottom; the solid end faces the chrome.
  const stops = edge === "top" ? [[0, 1], [0.6, 0.88], [1, 0]] : [[0, 0], [0.45, 0.62], [1, 0.94]];
  return <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, height, [edge]: 0 }}>
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {stops.map(([offset, opacity]) => <Stop key={offset} offset={offset} stopColor={t.bg} stopOpacity={opacity} />)}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  </View>;
}
