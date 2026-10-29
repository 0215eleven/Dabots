import React, { useMemo, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { LegendList } from "@legendapp/list/react-native";
import { Stack, useRouter } from "expo-router";
import type { Conversation } from "@ds-bot/mobile-sdk";
import { ConversationRow } from "../../../src/home/ConversationRow";
import { usePreviews } from "../../../src/home/usePreviews";
import { useI18n } from "../../../src/i18n";
import { orderConversations } from "../../../src/logic/conversation-order";
import { selectionFeedback, successFeedback } from "../../../src/media/haptics";
import { useSession } from "../../../src/session/SessionProvider";
import { useTheme } from "../../../src/theme";

export default function Chats() {
  const t = useTheme();
  const { tr, locale } = useI18n();
  const router = useRouter();
  const { workspace, resume, open, error, loading } = useSession();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const team = workspace.team;
  const previews = usePreviews(workspace.conversations);
  const mains = team.mainBotIds?.length ? team.mainBotIds : team.mainBotId ? [team.mainBotId] : [];
  const rows = useMemo(() => orderConversations(workspace.conversations.filter(item => {
    if (item.kind === "room" && team.mobileCapabilities?.groups === false) return false;
    const bot = team.bots.find(entry => entry.id === item.id || entry.sessionId === item.sessionId);
    const room = team.rooms.find(entry => entry.id === item.id);
    const hidden = item.hidden || bot?.hidden || room?.hidden;
    return (!hidden || (bot && mains.includes(bot.id))) && (!query || `${item.name} ${item.role || ""}`.toLowerCase().includes(query.toLowerCase()));
  }), previews, item => {
    const entry = team.bots.find(x => x.id === item.id || x.sessionId === item.sessionId) || team.rooms.find(x => x.id === item.id);
    return !!(item.pinned || entry?.pinned);
  }), [workspace.conversations, team, previews, query, mains.join(",")]);

  const pull = async () => {
    setRefreshing(true);
    selectionFeedback();
    resume();
    await workspace.refresh({ fresh: true }).catch(() => {});
    successFeedback();
    setRefreshing(false);
  };
  const empty = loading ? "" : query ? tr("No conversations found.") : workspace.online ? tr("No conversations yet.") : tr("Connecting…");

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: tr("Chats") }} />
      <Stack.SearchBar placeholder={tr("Search conversations")} onChangeText={event => setQuery(event.nativeEvent.text)} onCancelButtonPress={() => setQuery("")} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle" title={tr("More")}>
          <Stack.Toolbar.MenuAction icon="arrow.clockwise" onPress={() => { selectionFeedback(); resume(); }}>{tr("Reconnect now")}</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="rectangle.stack" onPress={() => router.push("/classic")}>{tr("Classic view")}</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <LegendList<Conversation>
        data={rows}
        keyExtractor={item => item.id}
        estimatedItemSize={76}
        recycleItems
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} />}
        ListHeaderComponent={error ? <Text style={{ color: t.error, padding: 16 }}>{error}</Text> : null}
        ListEmptyComponent={<Text style={{ color: t.muted, textAlign: "center", padding: 32 }}>{empty}</Text>}
        renderItem={({ item }) => (
          <ConversationRow
            item={item}
            team={team}
            preview={previews[item.id]}
            locale={locale}
            unread={false}
            onPress={() => { selectionFeedback(); open(item); }}
          />
        )}
      />
    </View>
  );
}
