import React, { memo } from "react";
import { Text, View } from "react-native";
import type { Conversation, Message } from "@ds-bot/mobile-sdk";
import { BotAvatar, RoomAvatar } from "../components/BotAvatar";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { tr } from "../i18n";
import { conversationTime } from "../logic/conversation-order";
import { groupWorkMembers, ownBotWork, workDescription } from "../logic/group-work";
import { useTheme } from "../theme";
import type { TeamState } from "../types";

function stamp(value: number, locale: string) {
  if (!value) return "";
  const date = new Date(value), tag = locale === "zh" ? "zh-CN" : "en-US";
  return date.toLocaleDateString() === new Date().toLocaleDateString()
    ? date.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(tag, { month: "short", day: "numeric" });
}

export const ConversationRow = memo(function ConversationRow({ item, team, preview, locale, unread, onPress, onLongPress }: {
  item: Conversation; team: TeamState; preview?: Message; locale: string; unread: boolean; onPress(): void; onLongPress?(): void;
}) {
  const t = useTheme();
  const bot = team.bots.find(entry => entry.id === item.id || entry.sessionId === item.sessionId);
  const room = team.rooms.find(entry => entry.id === item.id || `room:${entry.id}` === item.id);
  const mains = team.mainBotIds?.length ? team.mainBotIds : team.mainBotId ? [team.mainBotId] : [];
  const waiting = team.work?.approvals.some(entry => bot ? entry.botId === bot.id && !entry.roomId : room ? entry.roomId === room.id : false);
  const work = bot ? ownBotWork(bot.id, team) : room ? groupWorkMembers(room, team).find(member => member.work)?.work : undefined;
  const status = waiting ? tr("Waiting for approval") : work?.switching ? tr("Moving to a fresh conversation") : workDescription(work) || (work ? tr("Working") : "");
  const text = status || preview?.text.replace(/\s+/g, " ").trim() || (preview?.attachments?.length ? tr("Attachment message") : "") || (typeof item.preview === "string" ? item.preview : "");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr("Open {p0}", { p0: String(item.name) })}
      onPress={onPress}
      onLongPress={onLongPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}
    >
      {bot ? <BotAvatar bot={bot} size={52} main={mains.includes(bot.id)} live={!!item.waiting} />
        : room ? <RoomAvatar room={room} team={team} size={52} />
        : <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.bubble }} />}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.ink, fontSize: 17, fontWeight: unread ? "700" : "600" }}>{item.name}</Text>
          <Text style={{ color: t.faint, fontSize: 13 }}>{stamp(conversationTime(item, preview), locale)}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={2} style={{ flex: 1, color: waiting ? t.accent : t.muted, fontSize: 15 }}>{text}</Text>
          {unread ? <View accessibilityLabel={tr("Unread activity")} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent }} /> : null}
        </View>
      </View>
    </Pressable>
  );
});
