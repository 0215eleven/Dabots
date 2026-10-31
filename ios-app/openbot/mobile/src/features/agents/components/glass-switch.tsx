// DS Bot Mobile: a two-way switch on the same glass capsule as the home's round actions
// (ChatGlassButton): native Liquid Glass where available, otherwise its solid stand-in with the
// thin edge and top sheen. The selected side is a soft translucent thumb, not a hole in the glass.
import { GlassView } from "expo-glass-effect";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { ComponentType } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";
import { ChromeGlassSheen } from "@/shared/components/chrome-glass-sheen";
import { useChromeGlass } from "@/shared/lib/chrome-glass";
import { haptics } from "@/shared/lib/haptics";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

const HEIGHT = 44, INSET = 4;

export interface GlassSwitchOption<T extends string> {
  id: T;
  label: string;
  Icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number; accessible?: boolean }>;
}

export function GlassSwitch<T extends string>({ value, options, onChange }: { value: T; options: readonly GlassSwitchOption<T>[]; onChange: (value: T) => void }) {
  const { theme } = useUniwind();
  const dark = theme === "dark";
  const liquidGlass = useLiquidGlass();
  const chrome = useChromeGlass();
  const web = Platform.OS === "web";
  const [fallback, edge, foreground, muted] = useThemeColor(["default", "separator", "foreground", "muted"]);
  const thumb = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.07)";
  return (
    <GlassView
      glassEffectStyle={{ style: liquidGlass ? "regular" : "none", animate: true, animationDuration: 0.2 }}
      {...(Platform.OS === "ios" ? { colorScheme: dark ? "dark" : "light" } : {})}
      isInteractive={liquidGlass}
      accessibilityRole="tablist"
      style={{ backgroundColor: "transparent", borderCurve: "continuous", borderRadius: HEIGHT / 2, height: HEIGHT, overflow: "hidden", ...(web ? { boxShadow: chrome.boxShadow } : {}) }}
    >
      {liquidGlass ? null : (
        <View pointerEvents="none" style={{
          position: "absolute", inset: 0, borderRadius: HEIGHT / 2, overflow: "hidden",
          backgroundColor: web ? chrome.backgroundColor : String(fallback),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: web ? (dark ? "rgba(255,255,255,0.18)" : chrome.borderColor) : String(edge),
          borderTopColor: web ? (dark ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.9)") : String(edge),
        }}>
          <ChromeGlassSheen highlightOpacity={web ? (dark ? 0.14 : 0.22) : undefined} />
        </View>
      )}
      <View className="flex-row items-center" style={{ height: HEIGHT, paddingHorizontal: INSET }}>
        {options.map(({ id, label, Icon }) => {
          const selected = value === id, color = selected ? String(foreground) : String(muted);
          return (
            <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label}
              onPress={() => { if (!selected) { void haptics.selection(); onChange(id); } }}
              className="flex-row items-center gap-1.5 rounded-full px-3.5"
              style={({ pressed }) => ({ height: HEIGHT - INSET * 2, backgroundColor: selected ? thumb : "transparent", opacity: pressed ? 0.6 : 1 })}>
              <Icon size={16} color={color} strokeWidth={2} accessible={false} />
              <Typography.Paragraph style={{ fontSize: 14, lineHeight: 18, fontWeight: "600", color }}>{label}</Typography.Paragraph>
            </Pressable>
          );
        })}
      </View>
    </GlassView>
  );
}
