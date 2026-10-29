// DS Bot Mobile home list drawn with OpenBot components (PolyForm Noncommercial 1.0.0, see ./LICENSE).
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import React, { memo, useMemo, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import Animated from "react-native-reanimated";
import type { Conversation, Message } from "@ds-bot/mobile-sdk";
import { RoomAvatar } from "../components/BotAvatar";
import { usePreviews } from "../home/usePreviews";
import { orderConversations } from "../logic/conversation-order";
import { groupWorkMembers, ownBotWork, workDescription } from "../logic/group-work";
import { tr } from "../i18n";
import { useSession } from "../session/SessionProvider";
import type { TeamState } from "../types";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { LargeTitle, LargeTitleBar, useLargeTitleScroll } from "@/shared/components/large-title";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

function stamp(value: number, language: string) {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleDateString() === new Date().toLocaleDateString()
    ? date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(language, { month: "short", day: "numeric" });
}
const time = (item: Conversation, preview?: Message) => Math.max(Number(new Date(String(item.updatedAt ?? 0))) || 0, Number(new Date(preview?.createdAt ?? 0)) || 0);

const Row = memo(function Row({ item, team, preview, serverId, onOpen }: { item: Conversation; team: TeamState; preview?: Message; serverId: string; onOpen(item: Conversation): void }) {
  const { locale } = useText();
  const [background] = useThemeColor(["background"]);
  const bot = team.bots.find((entry) => entry.id === item.id || entry.sessionId === item.sessionId);
  const room = team.rooms.find((entry) => entry.id === item.id || `room:${entry.id}` === item.id);
  const waiting = team.work?.approvals.some((entry) => (bot ? entry.botId === bot.id && !entry.roomId : room ? entry.roomId === room.id : false));
  const work = bot ? ownBotWork(bot.id, team) : room ? groupWorkMembers(room, team).find((member) => member.work)?.work : undefined;
  const line = waiting ? tr("Waiting for approval") : workDescription(work) || markdownPreviewText(preview?.text ?? "");
  const subtitle = (bot?.role ?? "").trim();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.name}
      className="w-full"
      delayLongPress={longPressDelay}
      onLongPress={() => void haptics.longPress()}
      onPress={() => onOpen(item)}
    >
      {({ pressed }) => (
        <View className="min-h-20 w-full flex-row items-center gap-3 py-1" style={{ backgroundColor: background, opacity: pressed ? 0.58 : 1, paddingLeft: 20, paddingRight: 20 }}>
          {room ? <RoomAvatar room={room} team={team} size={54} /> : <BloubAvatar agentId={bot?.id ?? item.id} serverId={serverId} seed={bot?.id ?? item.id} size={54} animateIdle={false} />}
          <View className="min-w-0 flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              <Typography.Paragraph className="font-semibold min-w-0 flex-1" numberOfLines={1} style={typeScale.rowTitle}>{item.name}</Typography.Paragraph>
              <Typography.Paragraph className={waiting ? "text-accent" : "text-muted"} style={typeScale.caption}>{stamp(time(item, preview), locale)}</Typography.Paragraph>
            </View>
            {subtitle ? <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>{subtitle}</Typography.Paragraph> : null}
            <Typography.Paragraph className={waiting ? "text-accent" : "text-text-secondary"} numberOfLines={1} style={typeScale.preview}>{line}</Typography.Paragraph>
          </View>
        </View>
      )}
    </Pressable>
  );
});

export function OpenBotHome() {
  const { workspace, host, open, resume, loading, error } = useSession();
  const scroll = useLargeTitleScroll();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const team = workspace.team;
  const previews = usePreviews(workspace.conversations);
  const rows = useMemo(() => {
    const mains = team.mainBotIds?.length ? team.mainBotIds : team.mainBotId ? [team.mainBotId] : [];
    const needle = query.trim().toLowerCase();
    return orderConversations(workspace.conversations.filter((item) => {
      if (item.kind === "room" && team.mobileCapabilities?.groups === false) return false;
      const bot = team.bots.find((entry) => entry.id === item.id || entry.sessionId === item.sessionId);
      const room = team.rooms.find((entry) => entry.id === item.id);
      const hidden = item.hidden || bot?.hidden || room?.hidden;
      return (!hidden || (bot && mains.includes(bot.id))) && (!needle || `${item.name} ${item.role ?? ""}`.toLowerCase().includes(needle));
    }), previews, (item) => !!(item.pinned || team.bots.find((x) => x.id === item.id)?.pinned || team.rooms.find((x) => x.id === item.id)?.pinned));
  }, [workspace.conversations, team, previews, query]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: "", headerTransparent: true, headerShadowVisible: false }} />
      <Stack.SearchBar placeholder={tr("Search conversations")} onChangeText={(event) => setQuery(event.nativeEvent.text)} onCancelButtonPress={() => setQuery("")} />
      <Animated.FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="always"
        contentContainerStyle={isAndroid ? { paddingTop: scroll.headerHeight } : undefined}
        onScroll={scroll.onScroll}
        scrollEventThrottle={16}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); resume(); void workspace.refresh({ fresh: true }).finally(() => setRefreshing(false)); }} />}
        ListHeaderComponent={<LargeTitle scroll={scroll} title={tr("Chats")} caption={host?.name} />}
        ListEmptyComponent={
          <Typography.Paragraph className="text-muted px-5 pt-6" style={typeScale.preview}>
            {error || (loading ? "" : workspace.online ? (query ? tr("No conversations found.") : tr("No conversations yet.")) : tr("Connecting…"))}
          </Typography.Paragraph>
        }
        renderItem={({ item }) => <Row item={item} team={team} preview={previews[item.id]} serverId={host?.serverId ?? ""} onOpen={open} />}
      />
      <LargeTitleBar scroll={scroll} title={tr("Chats")} surface="canvas" />
    </View>
  );
}
