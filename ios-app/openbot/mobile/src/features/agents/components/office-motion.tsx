// DS Bot Mobile: the office's small animations. A Bot types while it works, talks while it
// answers, sways under an amber "?" while it waits for you and breathes with floating z's while it
// is free. Every loop stops (and the bubbles stay) when reduced motion is on.
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type ReactNode, useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useReducedMotion } from "@/shared/lib/motion";

export type SeatMotion = "typing" | "talking" | "waiting" | "idle";

/** A 0 → 1 → 0 loop, or a still 0 with reduced motion. */
function useLoop(duration: number, delay = 0, pause = 0): SharedValue<number> {
  const reducedMotion = useReducedMotion();
  const value = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) { cancelAnimation(value); value.set(0); return; }
    const half = { duration: duration / 2, easing: Easing.inOut(Easing.quad) };
    value.set(withDelay(delay, withRepeat(withSequence(withTiming(1, half), withTiming(0, half), withTiming(0, { duration: pause })), -1)));
    return () => cancelAnimation(value);
  }, [reducedMotion, value, duration, delay, pause]);
  return value;
}

/** The avatar's body language for its state. */
export function Seat({ motion, children }: { motion: SeatMotion; children: ReactNode }) {
  const loop = useLoop(motion === "typing" ? 280 : motion === "talking" ? 560 : motion === "waiting" ? 900 : 3200, 0, motion === "waiting" ? 900 : 0);
  const style = useAnimatedStyle(() => {
    const t = loop.get();
    if (motion === "typing") return { transform: [{ translateY: -2.5 * t }] };
    if (motion === "talking") return { transform: [{ scale: 1 + 0.07 * t }] };
    if (motion === "waiting") return { transform: [{ rotate: `${Math.sin(t * Math.PI * 2) * 7}deg` }] };
    return { transform: [{ scale: 1 + 0.035 * t }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

function Dot({ delay, color }: { delay: number; color: string }) {
  const loop = useLoop(900, delay);
  const style = useAnimatedStyle(() => ({ opacity: 0.3 + 0.7 * loop.get(), transform: [{ translateY: -1.5 * loop.get() }] }));
  return <Animated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }, style]} />;
}

function Z({ delay, color, size }: { delay: number; color: string; size: number }) {
  const reducedMotion = useReducedMotion();
  const rise = useSharedValue(reducedMotion ? 0.4 : 0);
  useEffect(() => {
    if (reducedMotion) { cancelAnimation(rise); rise.set(0.4); return; }
    rise.set(withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 }), withTiming(0, { duration: 600 })), -1)));
    return () => cancelAnimation(rise);
  }, [reducedMotion, rise, delay]);
  const style = useAnimatedStyle(() => ({ opacity: rise.get() < 0.05 ? 0 : 1 - rise.get(), transform: [{ translateY: -16 * rise.get() }, { translateX: 6 * rise.get() }] }));
  return <Animated.View style={[{ position: "absolute" }, style]}><Typography.Paragraph style={{ fontSize: size, lineHeight: size + 2, fontWeight: "700", color }}>z</Typography.Paragraph></Animated.View>;
}

export type BubbleKind = { kind: "text"; text: string } | { kind: "dots" } | { kind: "ask" } | { kind: "sleep" };

/** What the Bot says over its head, anchored at its centre bottom. */
export function Bubble({ bubble, maxWidth }: { bubble: BubbleKind; maxWidth: number }) {
  const [background, foreground, muted, warning, line] = useThemeColor(["background", "foreground", "muted", "warning", "separator"]);
  const askLoop = useLoop(700, 0, 500);
  const askStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * askLoop.get() }] }));
  if (bubble.kind === "sleep") return (
    <View pointerEvents="none" style={{ width: 24, height: 22 }}>
      <Z delay={0} color={String(muted)} size={13} />
      <View style={{ position: "absolute", left: 10, top: -5 }}><Z delay={1200} color={String(muted)} size={10} /></View>
    </View>
  );
  const ask = bubble.kind === "ask";
  const fill = ask ? String(warning) : String(background);
  return (
    <Animated.View pointerEvents="none" entering={FadeIn.duration(220)} style={[{ alignItems: "center" }, ask ? askStyle : null]}>
      <View className="flex-row items-center" style={{ maxWidth, minHeight: 22, paddingHorizontal: ask ? 8 : 8, borderRadius: 11, backgroundColor: fill, borderWidth: ask ? 0 : 1, borderColor: String(line), gap: 3 }}>
        {bubble.kind === "text"
          ? <>
              <Typography.Paragraph numberOfLines={1} style={{ fontSize: 11, lineHeight: 15, color: String(foreground), flexShrink: 1 }}>{bubble.text}</Typography.Paragraph>
              <Dot delay={0} color={String(muted)} />
            </>
          : bubble.kind === "dots"
            ? [0, 150, 300].map(delay => <Dot key={delay} delay={delay} color={String(foreground)} />)
            : <Typography.Paragraph style={{ fontSize: 13, lineHeight: 17, fontWeight: "800", color: "#ffffff" }}>?</Typography.Paragraph>}
      </View>
      <View style={{ width: 8, height: 8, marginTop: -4, transform: [{ rotate: "45deg" }], backgroundColor: fill, borderRightWidth: ask ? 0 : 1, borderBottomWidth: ask ? 0 : 1, borderColor: String(line) }} />
    </Animated.View>
  );
}

/** Lines of code scrolling up a working monitor. */
export function ScreenCode({ width, height }: { width: number; height: number }) {
  const loop = useLoop(1600);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -height * 0.35 * loop.get() }] }));
  const widths = [0.7, 0.45, 0.6, 0.3, 0.55, 0.4];
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height, overflow: "hidden", padding: 3 }}>
      <Animated.View style={[{ gap: 2.5 }, style]}>
        {widths.map((value, index) => <View key={index} style={{ width: (width - 6) * value, height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.55)", marginLeft: index % 3 === 1 ? 4 : 0 }} />)}
      </Animated.View>
    </View>
  );
}
