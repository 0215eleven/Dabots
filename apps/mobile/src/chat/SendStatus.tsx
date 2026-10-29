import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { Icon } from "../components/UI";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";
import type { ChatRow } from "./rows";

/** Under your own bubble: sending, sent, or a failure you can act on. */
export function SendStatus({ send, onRetry, onDiscard }: { send: NonNullable<ChatRow["send"]>; onRetry(): void; onDiscard(): void }) {
  const t = useTheme();
  const { tr } = useI18n();
  if (send.state === "sending") return (
    <Animated.View entering={FadeIn.duration(120)} style={{ flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-end", paddingRight: 4 }} accessibilityLabel={tr("Sending…")}>
      <ActivityIndicator size="small" color={t.faint} />
      <Text style={{ color: t.faint, fontSize: 12 }}>{tr("Sending…")}</Text>
    </Animated.View>
  );
  if (send.state === "sent") return (
    <Animated.View entering={FadeIn.duration(120)} style={{ flexDirection: "row", gap: 4, alignItems: "center", alignSelf: "flex-end", paddingRight: 4 }} accessibilityLabel={tr("Sent")}>
      <Icon name="check" size={14} color={t.faint} />
      <Text style={{ color: t.faint, fontSize: 12 }}>{tr("Sent")}</Text>
    </Animated.View>
  );
  const rejected = send.state === "rejected";
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center", alignSelf: "flex-end", paddingRight: 4 }}>
      <Text style={{ color: t.error, fontSize: 12 }}>{rejected ? tr("Rejected by the host") : tr("Not sent")}</Text>
      {rejected ? null : <Pressable accessibilityRole="button" accessibilityLabel={tr("Retry sending")} onPress={onRetry} hitSlop={10}><Text style={{ color: t.accent, fontSize: 12, fontWeight: "600" }}>{tr("Retry")}</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={tr("Delete unsent message")} onPress={onDiscard} hitSlop={10}><Text style={{ color: t.muted, fontSize: 12 }}>{tr("Delete")}</Text></Pressable>
    </View>
  );
}
