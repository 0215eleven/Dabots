import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import { Glass } from "./Glass";
import { Icon, Sheet } from "./UI";
import { contrastText, useTheme } from "../theme";
import { useI18n } from "../i18n";
import { hostAddress, hostKey, type SavedHost } from "../logic/hosts";

const Dot = ({ color }: { color: string }) => <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;

/** The small computer pill at the top left of Chats. */
export function HostPill({ name, online, onPress }: { name: string; online: boolean; onPress: () => void }) {
  const t = useTheme();
  const { tr } = useI18n();
  return <Glass radius={20} style={{ maxWidth: "100%" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={tr("Switch computer, current: {name}", { name })} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, height: 40, paddingLeft: 14, paddingRight: 12, borderRadius: 20, backgroundColor: pressed ? t.hover : undefined })}>
      <Icon name="server" size={16} color={t.muted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: t.ink, fontSize: 15, fontWeight: "600" }}>{name}</Text>
      <Dot color={online ? t.success : t.faint} />
      <Icon name="expand" size={16} color={t.muted} />
    </Pressable>
  </Glass>;
}

/** Switch computer: saved computers in one card, with an edit mode to remove old ones. */
export function HostSheet<T extends SavedHost>({ visible, hosts, current, online, onClose, onSwitch, onAdd, onRemove }: {
  visible: boolean;
  hosts: T[];
  /** The open computer, if any. */
  current: T | null;
  online: boolean;
  onClose: () => void;
  onSwitch: (host: T) => void;
  onAdd: () => void;
  onRemove: (host: T) => void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const [editing, setEditing] = useState(false);
  // Removing deletes the pairing, history and drafts, so it takes a second tap.
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => { if (!visible) setEditing(false); }, [visible]);
  useEffect(() => setConfirming(null), [editing]);
  const isCurrent = (host: T) => !!current && hostKey(host) === hostKey(current);
  const row = { flexDirection: "row" as const, alignItems: "center" as const, gap: 14, minHeight: 72, paddingHorizontal: 18 };
  const divider = <View style={{ height: 0.5, marginLeft: 58, marginRight: 18, backgroundColor: t.line }} />;
  return <Sheet title={tr("Switch computer")} visible={visible} onClose={onClose}
    headerLeft={<Pressable accessibilityRole="button" accessibilityLabel={tr(editing ? "Done" : "Edit")} onPress={() => setEditing(value => !value)}
      style={({ pressed }) => ({ height: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: "center", backgroundColor: pressed ? t.active : t.hover })}>
      <Text style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>{tr(editing ? "Done" : "Edit")}</Text>
    </Pressable>}>
    <Text style={{ color: t.muted, fontSize: 15, fontWeight: "600", paddingHorizontal: 18 }}>{tr("My computers")}</Text>
    <View style={{ backgroundColor: t.card, borderRadius: 24, borderWidth: 0.5, borderColor: t.cardEdge, overflow: "hidden" }}>
      {hosts.map((host, index) => {
        const active = isCurrent(host);
        const removable = editing && !active;
        return <React.Fragment key={hostKey(host) || "default"}>
          {index > 0 && divider}
          {/* The remove button sits beside the row, not inside it, so it stays tappable while the row is disabled. */}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable accessibilityRole="button" disabled={editing}
              accessibilityLabel={active ? tr("{name}, current computer", { name: host.name }) : tr("Switch to {name}", { name: host.name })}
              onPress={() => onSwitch(host)}
              style={({ pressed }) => ({ ...row, flex: 1, paddingRight: removable ? 8 : 18, backgroundColor: pressed ? t.hover : undefined })}>
              <Icon name="server" size={24} color={active ? t.accent : t.ink} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text numberOfLines={1} style={{ color: t.ink, fontSize: 18, fontWeight: "600" }}>{host.name}</Text>
                <Text numberOfLines={1} style={{ color: active ? (online ? t.success : t.muted) : t.muted, fontSize: 14 }}>
                  {active ? tr(online ? "Current computer · Connected" : "Current computer · Offline") : editing ? hostAddress(host) : tr("Tap to connect")}
                </Text>
              </View>
              {!removable && (active ? <Dot color={online ? t.success : t.faint} /> : <Icon name="chevron" size={16} color={t.faint} />)}
            </Pressable>
            {removable && (confirming === hostKey(host)
              ? <Pressable accessibilityRole="button" accessibilityLabel={tr("Confirm removing {name}", { name: host.name })} onPress={() => { setConfirming(null); onRemove(host); }} hitSlop={8}
                style={{ height: 34, marginRight: 18, paddingHorizontal: 14, borderRadius: 17, justifyContent: "center", backgroundColor: t.error }}>
                <Text style={{ color: contrastText(t.error), fontSize: 14, fontWeight: "600" }}>{tr("Confirm removal")}</Text>
              </Pressable>
              : <Pressable accessibilityRole="button" accessibilityLabel={tr("Remove {name}", { name: host.name })} onPress={() => setConfirming(hostKey(host))} hitSlop={8}
                style={{ height: 34, marginRight: 18, paddingHorizontal: 14, borderRadius: 17, justifyContent: "center", backgroundColor: t.hover }}>
                <Text style={{ color: t.error, fontSize: 14, fontWeight: "600" }}>{tr("Remove")}</Text>
              </Pressable>)}
          </View>
        </React.Fragment>;
      })}
      {hosts.length > 0 && divider}
      <Pressable accessibilityRole="button" accessibilityLabel={tr("Add a computer")} onPress={onAdd}
        style={({ pressed }) => ({ ...row, minHeight: 60, backgroundColor: pressed ? t.hover : undefined })}>
        <Icon name="plus" size={24} color={t.accent} />
        <Text style={{ flex: 1, color: t.accent, fontSize: 17, fontWeight: "600" }}>{tr("Add a computer")}</Text>
      </Pressable>
    </View>
    <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18, paddingHorizontal: 18 }}>
      {tr(editing ? "Removing a computer deletes its pairing, history and drafts from this phone. Revoke it on the computer to end its access there." : "Each computer keeps its own pairing, history and drafts on this phone.")}
    </Text>
  </Sheet>;
}
