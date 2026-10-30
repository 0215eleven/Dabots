import { type GlassColorScheme, GlassView } from "expo-glass-effect";
import type { PropsWithChildren } from "react";
import { type AccessibilityValue, Platform, Pressable, StyleSheet, type ViewStyle } from "react-native";
import Animated, { type CSSTransitionProperties, cubicBezier } from "react-native-reanimated";
import { useThemeColor } from "heroui-native/hooks";
import { useUniwind } from "uniwind";
import { ChromeGlassSheen } from "@/shared/components/chrome-glass-sheen";
import { useChromeGlass } from "@/shared/lib/chrome-glass";

const FADE: CSSTransitionProperties = {
  transitionProperty: "opacity",
  transitionDuration: 200,
  transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
};

interface ChatGlassButtonProps extends PropsWithChildren {
  accessibilityLabel: string;
  accessibilityValue?: AccessibilityValue;
  className?: string;
  /** The glass follows the system appearance unless a surface that is always dark asks for dark. */
  colorScheme?: GlassColorScheme;
  disabled?: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  height?: number;
  /**
   * Hides the button in place. Glass stops rendering under any ancestor with zero opacity, so
   * the glass itself turns to `none` with its native animation and only the icon fades.
   */
  hidden?: boolean;
  liquidGlassAvailable: boolean;
  /** A native MenuView may own the action instead of a React press handler. */
  onPress?: () => void;
  width?: number;
}

/** Shared glass for compact navigation and floating chat actions, with an icon, label, or both. */
export function ChatGlassButton({
  accessibilityLabel,
  accessibilityValue,
  children,
  className = "flex-1 flex-row items-center justify-center",
  colorScheme,
  disabled = false,
  fallbackBackground,
  height = 48,
  hidden,
  liquidGlassAvailable,
  onPress,
  width,
}: ChatGlassButtonProps) {
  const { theme } = useUniwind();
  const edge = useThemeColor("separator");
  const chrome = useChromeGlass();
  const web = Platform.OS === "web";
  const dark = colorScheme === "dark" || (colorScheme !== "light" && theme === "dark");
  return (
    <GlassView
      glassEffectStyle={{
        style: liquidGlassAvailable && !hidden ? "regular" : "none",
        animate: true,
        animationDuration: 0.2,
      }}
      {...(Platform.OS === "ios" ? { colorScheme: colorScheme ?? (theme === "dark" ? "dark" : "light") } : {})}
      isInteractive={liquidGlassAvailable && !disabled && !hidden}
      pointerEvents={hidden ? "none" : "auto"}
      style={{
        backgroundColor: "transparent",
        borderCurve: "continuous",
        borderRadius: height / 2,
        height,
        overflow: "hidden",
        opacity: disabled ? 0.45 : 1,
        width,
        ...(web ? { boxShadow: chrome.boxShadow } : {}),
      }}
    >
      {liquidGlassAvailable ? null : (
        // The solid stand-in for glass, a layer of its own so it can fade with the icon.
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: web && !colorScheme ? chrome.backgroundColor : fallbackBackground,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: web ? (dark ? "rgba(255,255,255,0.18)" : chrome.borderColor) : edge,
            borderTopColor: web ? (dark ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.9)") : edge,
            borderRadius: height / 2,
            overflow: "hidden",
            opacity: hidden ? 0 : 1,
            ...FADE,
          }}
        >
          <ChromeGlassSheen highlightOpacity={web ? (dark ? 0.14 : 0.22) : undefined} />
        </Animated.View>
      )}
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={accessibilityValue}
        aria-valuetext={accessibilityValue?.text}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        className={className}
        hitSlop={4}
        style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        onPress={onPress}
      >
        {/* Only a caller that hides the button gets the fading wrapper, so a row of icon and label
            laid out by `className` stays a direct child of the pressable everywhere else. */}
        {hidden === undefined ? (
          children
        ) : (
          <Animated.View style={{ opacity: hidden ? 0 : 1, ...FADE }}>{children}</Animated.View>
        )}
      </Pressable>
    </GlassView>
  );
}

/** Text on the same glass capsule as the buttons beside it, such as a position, with no action. */
export function ChatGlassLabel({
  children,
  colorScheme,
  fallbackBackground,
  height = 48,
  hidden,
  liquidGlassAvailable,
}: Pick<
  ChatGlassButtonProps,
  "children" | "colorScheme" | "fallbackBackground" | "height" | "hidden" | "liquidGlassAvailable"
>) {
  return (
    <GlassView
      glassEffectStyle={{
        style: liquidGlassAvailable && !hidden ? "regular" : "none",
        animate: true,
        animationDuration: 0.2,
      }}
      colorScheme={colorScheme}
      isInteractive={false}
      pointerEvents="none"
      style={{
        backgroundColor: "transparent",
        borderCurve: "continuous",
        borderRadius: height / 2,
        height,
        justifyContent: "center",
        overflow: "hidden",
        paddingHorizontal: 16,
      }}
    >
      {liquidGlassAvailable ? null : (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: fallbackBackground,
            opacity: hidden ? 0 : 1,
            ...FADE,
          }}
        />
      )}
      <Animated.View style={{ opacity: hidden ? 0 : 1, ...FADE }}>{children}</Animated.View>
    </GlassView>
  );
}

export function ChatGlassIconButton(props: Omit<ChatGlassButtonProps, "className" | "height" | "width">) {
  return <ChatGlassButton {...props} width={48} />;
}
