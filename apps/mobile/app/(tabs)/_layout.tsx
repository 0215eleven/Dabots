import React from "react";
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useI18n } from "../../src/i18n";
import { useSession } from "../../src/session/SessionProvider";
import { useTheme } from "../../src/theme";

export default function TabsLayout() {
  const { loading, host } = useSession();
  const { tr } = useI18n();
  const t = useTheme();
  // No paired computer: pairing is the first screen, not a tab.
  if (!loading && !host) return <Redirect href="/pairing" />;
  return (
    <NativeTabs tintColor={t.accent} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(chats)">
        <NativeTabs.Trigger.Icon sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }} md="chat" />
        <NativeTabs.Trigger.Label>{tr("Chats")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} md="settings" />
        <NativeTabs.Trigger.Label>{tr("Settings")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
