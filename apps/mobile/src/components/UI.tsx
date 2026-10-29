import { useEdgeBack } from "./EdgeBack";
import { tr } from "../i18n";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  Switch,
} from "react-native";
import { AnimatedPressable as Pressable, PageTransition } from "./Motion";
import { Glass } from "./Glass";
import { contrastText, useTheme } from "../theme";
import { BRAND_BLUE } from "../logic/colors";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
export function Label({
  children,
  muted = false,
  large = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
  large?: boolean;
}) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: muted ? t.muted : t.ink,
        fontSize: large ? 19 : 14,
        fontWeight: large ? "600" : "400",
        lineHeight: large ? 26 : 21,
      }}
    >
      {children}
    </Text>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  danger = false,
  compact = false,
  floating = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  danger?: boolean;
  compact?: boolean;
  floating?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingVertical: compact ? 8 : 10,
        paddingHorizontal: compact ? 13 : 16,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
        backgroundColor: secondary ? (floating ? t.surface : t.hover) : danger ? t.error : t.accent,
        borderColor: t.line,
        borderWidth: floating ? 1 : 0,
      })}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: "500",
          color: secondary ? (danger ? t.error : t.ink) : danger ? contrastText(t.error) : t.accentText,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  ...props
}: TextInputProps & {
  label: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: t.ink, fontSize: 13, fontWeight: "500" }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        {...props}
        style={[
          {
            backgroundColor: t.surface,
            color: t.ink,
            minHeight: 44,
            padding: 12,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 14,
            fontSize: 15,
            textAlignVertical: "top",
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Notice({
  text,
  error = false,
  capsule = false,
}: {
  text?: string | null;
  error?: boolean;
  capsule?: boolean;
}) {
  const t = useTheme();
  if (!text) return null;
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={{
        borderRadius: capsule ? 999 : 16,
        backgroundColor: t.hover,
        // Only errors get an outline; plain notices are a quiet fill.
        borderColor: t.error,
        borderWidth: error ? 1 : 0,
        paddingVertical: 12,
        paddingHorizontal: capsule ? 20 : 16,
      }}
    >
      <Text
        selectable
        style={{
          color: error ? t.error : t.muted,
          fontSize: 13,
          lineHeight: 20,
        }}
      >
        {tr(text)}
      </Text>
    </View>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.card,
        borderRadius: 22,
        padding: 16,
        gap: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.cardEdge,
      }}
    >
      {children}
    </View>
  );
}
export function Busy({ text = "Loading…" }: { text?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        padding: 22,
        flexDirection: "row",
        gap: 12,
        justifyContent: "center",
      }}
    >
      <ActivityIndicator color={t.accent} />
      <Label muted>{tr(text)}</Label>
    </View>
  );
}
export function Sheet({
  title,
  visible,
  onClose,
  children,
  headerLeft,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** An action left of a centred title, as in iOS sheets (e.g. Edit). */
  headerLeft?: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "web" ? undefined : "padding"}
        style={{
          flex: 1,
          backgroundColor: "#0008",
          justifyContent: "flex-end",
        }}
      >
        <Pressable accessibilityRole="button" accessibilityLabel={tr("Close")} onPress={onClose} style={StyleSheet.absoluteFill} />
        <PageTransition distance={48} spring>
        <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: t.sheet,
            borderTopLeftRadius: 30,
            borderTopRightRadius: 30,
            maxHeight: "90%",
            overflow: "hidden",
            paddingTop: 10,
            paddingHorizontal: 20,
            paddingBottom: Math.max(16, insets.bottom + 8),
          }}
        >
          <View accessible={false} style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: t.lineStrong, marginBottom: 12 }} />
          {headerLeft ? (
            <View style={styles.between}>
              <View style={{ minWidth: 72, alignItems: "flex-start" }}>{headerLeft}</View>
              <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, textAlign: "center", color: t.ink, fontSize: 18, fontWeight: "700" }}>{title}</Text>
              <View style={{ minWidth: 72, alignItems: "flex-end" }}><IconButton name="close" floating label={tr("Close")} onPress={onClose} /></View>
            </View>
          ) : (
            <View style={styles.between}>
              <Label large>{title}</Label>
              <IconButton name="close" floating label={tr("Close")} onPress={onClose} />
            </View>
          )}
          <ScrollView
            style={{ flexShrink: 1, minHeight: 0 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              gap: 16,
              paddingTop: 20,
              paddingBottom: 16,
            }}
          >
            {children}
          </ScrollView>
        </View>
        </View>
        </PageTransition>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  between: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "center",
  },
  page: { padding: 16, gap: 20, paddingBottom: 24 },
  caption: { fontSize: 12 },
  grow: { flex: 1 },
});
const iconNames = {
  menu: "menu", back: "chevron-left", close: "x", plus: "plus", search: "search",
  settings: "settings", bots: "users", groups: "message-circle", chat: "message-square", devices: "smartphone",
  schedules: "clock", usage: "bar-chart-2", pin: "bookmark", chevron: "chevron-right",
  up: "chevron-up", down: "arrow-down", more: "more-horizontal", check: "check", connectors: "link", secrets: "key", feedback: "message-square",
  microphone: "mic", folder: "folder", camera: "camera", image: "image", send: "arrow-up",
  expand: "chevron-down", server: "server", stop: "square", skills: "book-open", browser: "monitor", bell: "bell", reply: "corner-up-left", smile: "smile", copy: "copy", share: "share-2", download: "download", speaker: "volume-2",
} as const;
export type IconName = keyof typeof iconNames | "waveform";
export function Icon({ name, size = 22, color }: {name: IconName; size?: number; color?: string}) {
  const t = useTheme();
  return name === "waveform"
    ? <MaterialCommunityIcons name="waveform" size={size} color={color || t.ink} accessible={false} />
    : <Feather name={iconNames[name]} size={size} color={color || t.ink} accessible={false} />;
}
export function IconButton({ name, label, onPress, disabled = false, floating = false, primary = false, brand = false, size = 48, width = size }: {
  name: IconName; label: string; onPress: () => void; disabled?: boolean; floating?: boolean; primary?: boolean; brand?: boolean; size?: number; width?: number;
}) {
  const t = useTheme();
  const glass = floating && !primary && !brand;
  const button = <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}}
    disabled={disabled} onPress={onPress} style={({pressed}) => ({
      width: Math.max(44, width), height: Math.max(44, size), borderRadius:Math.max(44, size) / 2, alignItems:"center", justifyContent:"center",
      flexShrink:0, backgroundColor:brand ? BRAND_BLUE : primary ? t.ink : pressed ? t.hover : undefined,
      opacity:disabled ? .35 : pressed ? .65 : 1,
    })}><Icon name={name} size={name === "plus" ? 26 : 22} color={brand ? "#FFFFFF" : primary ? t.bg : t.ink}/></Pressable>;
  return glass ? <Glass radius={Math.max(44, size) / 2} style={{flexShrink:0}}>{button}</Glass> : button;
}
export function PageHeader({
  title,
  onBack,
  onOpenNavigation,
  right,
  close = false,
  floating = false,
  left,
}: {
  title: string;
  /** Replaces the title, e.g. a section switch on a tab page. */
  left?: React.ReactNode;
  onBack?: () => void;
  onOpenNavigation?: () => void;
  right?: React.ReactNode;
  close?: boolean;
  floating?: boolean;
}) {
  const t = useTheme();
  useEdgeBack(onBack);
  return (
    <View
      pointerEvents="box-none"
      style={{
        ...(floating ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 } as const : {}),
        flexDirection: "row",
        alignItems: "center",
        gap: 18,
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
        minHeight: 76,
      }}
    >
      {onBack ? (
        <IconButton name={close ? "close" : "back"} floating label={tr(close ? "Close" : "Back")} onPress={onBack} />
      ) : onOpenNavigation ? (
        <IconButton
          name="menu"
          label={tr("Open navigation")}
          onPress={onOpenNavigation}
        />
      ) : null}
      <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'flex-start' }}>
        {left || !!title && (floating
          ? <Glass radius={24} style={{ flexShrink: 1 }}><Text numberOfLines={1} style={{ fontSize: 19, fontWeight: "600", color: t.ink, paddingHorizontal: 16, paddingVertical: 11 }}>{title}</Text></Glass>
          : <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 21, fontWeight: "600", color: t.ink }}>{title}</Text>)}
      </View>
      {right}
    </View>
  );
}
/** The iOS large title shared by the three tab pages. */
export function LargeTitle({ children }: { children: string }) {
  const t = useTheme();
  return <Text accessibilityRole="header" numberOfLines={1} style={{ color: t.ink, fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.2, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 10 }}>{children}</Text>;
}
/** Distance from the screen bottom to the home dock: it sits just above the home indicator. */
export const dockBottom = (inset: number) => Math.max(10, inset - 8);
export const DOCK_HEIGHT = 56;
/** Bottom padding for a scroll view. Pages draw under the home indicator, so
 * the last row must clear it, and on the conversation list the dock too. */
export function useBottomClearance(dock = false) {
  const { bottom } = useSafeAreaInsets();
  return dock ? dockBottom(bottom) + DOCK_HEIGHT + 28 : bottom + 24;
}
export function Section({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontSize: 14,
          lineHeight: 20,
          fontWeight: "400",
          color: t.muted,
          paddingHorizontal: 20,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: t.card,
          borderRadius: 22,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.cardEdge,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
      {footer && (
        <Text
          style={{
            fontSize: 13,
            lineHeight: 18,
            color: t.muted,
            // Aligned with the section title and the row text inside the card.
            paddingHorizontal: 20,
          }}
        >
          {footer}
        </Text>
      )}
    </View>
  );
}
export function SettingRow({
  title,
  hint,
  children,
  onPress,
  leading,
  accessibilityLabel,
  danger = false,
  last = false,
  disabled = false,
  compact = false,
  selected,
  unavailable = false,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  leading?: React.ReactNode;
  accessibilityLabel?: string;
  compact?: boolean;
  danger?: boolean;
  last?: boolean;
  disabled?: boolean;
  /** A choice in a list: shows a check instead of a disclosure chevron. */
  selected?: boolean;
  /** The connected computer cannot open this from the phone; says so in place of the chevron. */
  unavailable?: boolean;
}) {
  const t = useTheme();
  const off = disabled || unavailable;
  const trailing = unavailable
    ? <Text style={{ color: t.faint, fontSize: 13 }}>{tr("On computer")}</Text>
    : selected !== undefined
      ? selected ? <Icon name="check" size={20} color={t.accent} /> : null
      : onPress && !danger ? <Icon name="chevron" size={16} color={t.faint} /> : null;
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, gap: 2, opacity: off ? 0.45 : 1 }}>
        <Text
          style={{
            color: danger ? t.error : t.ink,
            fontSize: 17,
            lineHeight: 22,
          }}
        >
          {title}
        </Text>
        {hint && (
          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>
            {hint}
          </Text>
        )}
      </View>
      {children}
      {trailing}
      {/* An inset hairline, as in iOS grouped lists. */}
      {!last && <View pointerEvents="none" style={{ position: "absolute", left: 20, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: t.lineStrong }} />}
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: compact ? 10 : 13,
    minHeight: compact ? 50 : 56,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={unavailable ? tr("On computer") : undefined}
      accessibilityState={{ disabled: off, selected }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        ...style,
        backgroundColor: pressed ? t.hover : undefined,
      })}
    >
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}
/** A flat list row, as on the conversation list: avatar, name with small
 * tags, a quiet line below, no card behind it. */
export function ListRow({
  leading,
  title,
  tags,
  meta,
  subtitle,
  trailing,
  onPress,
  onLongPress,
  onLayout,
  accessibilityLabel,
  selected,
}: {
  leading?: React.ReactNode;
  title: string;
  /** Short labels after the name; the first may be emphasised. */
  tags?: Array<string | { text: string; strong?: boolean } | false | null | undefined>;
  /** Right of the name, e.g. a time. */
  meta?: string;
  subtitle?: string;
  /** Right of the subtitle, e.g. an unread dot. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  onLayout?: React.ComponentProps<typeof View>["onLayout"];
  accessibilityLabel?: string;
  selected?: boolean;
}) {
  const t = useTheme();
  const chips = (tags || []).flatMap(tag => !tag ? [] : [typeof tag === "string" ? { text: tag, strong: false } : tag]);
  return (
    <Pressable
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={selected === undefined ? undefined : { selected }}
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 84,
        borderRadius: 20,
        backgroundColor: pressed ? t.hover : undefined,
      })}
    >
      {leading}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: t.ink, fontWeight: "600", fontSize: 17 }}>{title}</Text>
          {chips.map(chip => (
            <Text key={chip.text} numberOfLines={1} style={{ flexShrink: 2, fontSize: 12, lineHeight: 20, paddingHorizontal: 7, borderRadius: 7, overflow: "hidden",
              color: chip.strong ? t.accentText : t.tagInk, backgroundColor: chip.strong ? t.accent : t.tagBg }}>{chip.text}</Text>
          ))}
          <View style={{ flex: 1 }} />
          {!!meta && <Text style={{ fontSize: 13, color: t.faint }}>{meta}</Text>}
        </View>
        {(!!subtitle || !!trailing) && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, lineHeight: 21, color: t.muted }}>{subtitle}</Text>
            {trailing}
          </View>
        )}
      </View>
    </Pressable>
  );
}
export function ToggleRow({
  title,
  hint,
  value,
  onChange,
  disabled,
  last,
}: {
  title: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <SettingRow title={title} hint={hint} disabled={disabled} last={last}>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.accent }}
      />
    </SettingRow>
  );
}
export function Tag({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        fontSize: 11,
        lineHeight: 16,
        paddingHorizontal: 5,
        borderRadius: 4,
        color: t.tagInk,
        backgroundColor: t.tagBg,
        overflow: "hidden",
      }}
    >
      {children}
    </Text>
  );
}
