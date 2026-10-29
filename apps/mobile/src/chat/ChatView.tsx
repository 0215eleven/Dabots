import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Text, TextInput, View, type TextInputInstance } from "react-native";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Conversation } from "@ds-bot/mobile-sdk";
import { MessageBubble } from "../components/MessageBubble";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { Icon } from "../components/UI";
import { useI18n } from "../i18n";
import { errorFeedback, selectionFeedback, tapFeedback } from "../media/haptics";
import { useSession } from "../session/SessionProvider";
import { useTheme } from "../theme";
import type { Bot } from "../types";
import { SendStatus } from "./SendStatus";
import type { ChatRow } from "./rows";
import { useChat } from "./useChat";

const COMPOSER_MIN = 44;

function OwnBubble({ row, onRetry, onDiscard }: { row: ChatRow; onRetry(): void; onDiscard(): void }) {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} style={{ paddingHorizontal: 12, paddingVertical: 4, alignItems: "flex-end", gap: 4 }}>
      <View style={{ maxWidth: "84%", backgroundColor: row.send?.state === "failed" || row.send?.state === "rejected" ? t.error : t.messageBubble, borderRadius: 20, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 9, opacity: row.send?.state === "sending" ? 0.7 : 1 }}>
        <Text selectable style={{ color: t.messageText, fontSize: 16, lineHeight: 22 }}>{row.message.text}</Text>
      </View>
      {row.send ? <SendStatus send={row.send} onRetry={onRetry} onDiscard={onDiscard} /> : null}
    </Animated.View>
  );
}

function SendButton({ enabled, running, onSend, onStop }: { enabled: boolean; running: boolean; onSend(): void; onStop(): void }) {
  const t = useTheme();
  const { tr } = useI18n();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const stop = running && !enabled;
  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stop ? tr("Stop") : tr("Send")}
        disabled={!enabled && !stop}
        onPressIn={() => { scale.value = withSpring(0.88, { damping: 14 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 12 }); }}
        onPress={() => { tapFeedback(); if (stop) onStop(); else onSend(); }}
        style={{ width: COMPOSER_MIN - 4, height: COMPOSER_MIN - 4, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: enabled || stop ? t.accent : t.bubble }}
      >
        <Icon name={stop ? "stop" : "send"} size={18} color={enabled || stop ? t.accentText : t.faint} />
      </Pressable>
    </Animated.View>
  );
}

export function ChatView({ conversation }: { conversation: Conversation }) {
  const t = useTheme();
  const { tr } = useI18n();
  const insets = useSafeAreaInsets();
  const { client, host, workspace } = useSession();
  const chat = useChat(conversation.id);
  const list = useRef<LegendListRef>(null);
  const input = useRef<TextInputInstance>(null);
  const [atEnd, setAtEnd] = useState(true);
  const team = workspace.team;
  const room = team.rooms.find(item => item.id === conversation.id || `room:${item.id}` === conversation.id);
  const botFor = useCallback((author: unknown): Bot | undefined => {
    const id = typeof author === "string" ? author : typeof author === "object" && author ? (author as { id?: string }).id : undefined;
    return id ? team.bots.find(bot => bot.id === id) : team.bots.find(bot => bot.id === conversation.id || bot.sessionId === conversation.sessionId);
  }, [team.bots, conversation.id, conversation.sessionId]);

  // New own message: follow it to the bottom.
  const count = chat.rows.length;
  const last = chat.rows[count - 1];
  useEffect(() => { if (last?.send || atEnd) void list.current?.scrollToEnd({ animated: true }); }, [count, last?.key, last?.send, atEnd]);

  const canSend = chat.draft.trim().length > 0;
  const send = async () => {
    if (!canSend) return;
    const ok = await chat.send();
    if (!ok) errorFeedback();
  };
  const connection = chat.status === "connected" ? null : chat.status === "unauthorized" ? tr("This device was unpaired. Pair it again in Settings.") : tr("Connecting…");

  if (!client || !host) return null;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <LegendList
        ref={list}
        style={{ flex: 1 }}
        data={chat.rows}
        keyExtractor={row => row.key}
        estimatedItemSize={72}
        recycleItems
        alignItemsAtEnd
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainVisibleContentPosition
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        onStartReached={() => { if (chat.hasOlder) void chat.loadOlder(); }}
        onStartReachedThreshold={0.5}
        onScroll={event => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          setAtEnd(contentSize.height - contentOffset.y - layoutMeasurement.height < 80);
        }}
        scrollEventThrottle={64}
        renderItem={({ item }) => item.send ? (
          <OwnBubble row={item} onRetry={() => { selectionFeedback(); void chat.retry(item.send!.requestId); }} onDiscard={() => { selectionFeedback(); void chat.discard(item.send!.requestId); }} />
        ) : (
          <MessageBubble
            capabilities={team.mobileCapabilities}
            message={item.message}
            client={client}
            conversationId={conversation.id}
            serverId={host.serverId}
            bot={botFor(item.message.author)}
            bots={team.bots}
            showAuthor={!!room}
          />
        )}
        ListFooterComponent={chat.running ? <Text style={{ color: t.faint, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 }}>{tr("Working")}…</Text> : null}
      />
      {!atEnd ? (
        <Animated.View entering={FadeInDown} style={{ position: "absolute", right: 16, bottom: insets.bottom + 76 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={tr("Back to bottom")} onPress={() => { selectionFeedback(); void list.current?.scrollToEnd({ animated: true }); }}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: t.glassFill, borderWidth: 1, borderColor: t.glassEdge }}>
            <Icon name="down" size={18} />
          </Pressable>
        </Animated.View>
      ) : null}
      <KeyboardStickyView offset={{ closed: 0, opened: Platform.OS === "ios" ? insets.bottom : 0 }}>
        {connection ? <Text accessibilityLiveRegion="polite" style={{ color: t.faint, fontSize: 12, textAlign: "center", paddingVertical: 4 }}>{connection}</Text> : null}
        {chat.error ? <Text style={{ color: t.error, fontSize: 12, textAlign: "center", paddingVertical: 4 }}>{chat.error}</Text> : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: t.bg }}>
          <TextInput
            ref={input}
            value={chat.draft}
            onChangeText={chat.setDraft}
            placeholder={tr("Message")}
            placeholderTextColor={t.faint}
            multiline
            accessibilityLabel={tr("Message")}
            style={{ flex: 1, minHeight: COMPOSER_MIN, maxHeight: 140, borderRadius: 22, borderCurve: "continuous", paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16, color: t.ink, backgroundColor: t.bubble }}
          />
          <SendButton enabled={canSend} running={chat.running} onSend={() => void send()} onStop={() => void chat.stop()} />
        </View>
      </KeyboardStickyView>
    </View>
  );
}
