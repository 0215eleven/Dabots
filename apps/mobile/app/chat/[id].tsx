import React from "react";
import { Text } from "react-native";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { BotAvatar } from "../../src/components/BotAvatar";
import { ScreenActivity } from "../../src/components/ScreenActivity";
import { OpenBotChat } from "../../src/openbot/chat-screen";
import { useI18n } from "../../src/i18n";
import { useSession } from "../../src/session/SessionProvider";
import { useTheme } from "../../src/theme";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { tr } = useI18n();
  const router = useRouter();
  const focused = useIsFocused();
  const { workspace, host, resume } = useSession();
  const conversation = workspace.conversations.find(item => item.id === id);
  const bot = workspace.team.bots.find(entry => entry.id === id || entry.sessionId === conversation?.sessionId);
  return (
    <ScreenActivity.Provider value={focused}>
      <Stack.Screen options={{ title: conversation?.name ?? "", headerTransparent: true, headerShadowVisible: false, headerBackButtonDisplayMode: "minimal" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle" title={tr("More")}>
          <Stack.Toolbar.MenuAction icon="arrow.clockwise" onPress={resume}>{tr("Reconnect now")}</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="rectangle.stack" onPress={() => router.push("/classic")}>{tr("Classic view")}</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {conversation && host
        ? <OpenBotChat key={`${host.serverId}:${conversation.id}`} conversation={conversation} />
        : <Text style={{ color: t.muted, textAlign: "center", padding: 32 }}>{workspace.online ? tr("This conversation is no longer available.") : tr("Connecting…")}</Text>}
    </ScreenActivity.Provider>
  );
}
