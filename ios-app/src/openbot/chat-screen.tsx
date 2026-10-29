// DS Bot Mobile screen assembled from OpenBot chat components (PolyForm Noncommercial 1.0.0, see ./LICENSE).
// The data comes from this app's session, stream and outbox; none of OpenBot's connection code is used.
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useThemeColor } from "heroui-native/hooks";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Conversation } from "@ds-bot/mobile-sdk";
import { useChat } from "../chat/useChat";
import { useSession } from "../session/SessionProvider";
import { agentFor, chatTarget, outboxRowId, outboxStatuses, pendingChatMessages, toChatMessages } from "./adapters/chat-model";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatMessageList } from "@/features/chat/components/chat-message-list";
import { useChatMotion } from "@/features/chat/components/use-chat-motion";
import type { ChatBubbleMessage } from "@/features/chat/model/chat-messages";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { useReducedTransparency } from "@/shared/lib/use-reduced-transparency";

const NO_ALIASES: ReadonlyMap<string, string> = new Map();
const NO_MESSAGES: never[] = [];

export function OpenBotChat({ conversation }: { conversation: Conversation }) {
  const insets = useSafeAreaInsets();
  const { host, workspace, foreground: appActive } = useSession();
  const chat = useChat(conversation.id);
  const reducedTransparency = useReducedTransparency();
  const [foreground, muted, fieldBackground, raised, action, actionForeground, background] = useThemeColor([
    "foreground", "muted", "default", "surface-tertiary", "accent", "accent-foreground", "background",
  ]);
  const [replyTarget, setReplyTarget] = useState<ChatBubbleMessage | null>(null);
  const [sendRetryVersion, setSendRetryVersion] = useState(0);
  const team = workspace.team;
  const serverId = host?.serverId ?? "";
  const room = team.rooms.find((entry) => entry.id === conversation.id || `room:${entry.id}` === conversation.id);
  const bot = team.bots.find((entry) => entry.id === conversation.id || entry.sessionId === conversation.sessionId);
  const target = useMemo(() => chatTarget(conversation.id, serverId, conversation.name, team.bots, room, team), [conversation.id, conversation.name, serverId, team, room]);
  const agents = useMemo(() => team.bots.map((entry) => agentFor(entry, serverId)), [team.bots, serverId]);

  const echoed = useMemo(() => new Set(chat.messages.map((message) => message.requestId).filter((id): id is string => !!id)), [chat.messages]);
  const { messages: pending, waiting } = useMemo(() => pendingChatMessages(chat.outgoing, echoed), [chat.outgoing, echoed]);
  const messages = useMemo(() => [...toChatMessages(chat.messages, team.bots), ...pending], [chat.messages, team.bots, pending]);
  const editInto = useCallback((requestId: string) => {
    const item = chat.outgoing.find((entry) => entry.requestId === requestId);
    if (!item) return;
    void chat.discard(requestId);
    chat.setDraft(chat.draft ? `${chat.draft}\n${item.text}` : item.text);
  }, [chat]);
  const statuses = useMemo(() => outboxStatuses(waiting, workspace.online, {
    retry: (requestId) => { setSendRetryVersion((value) => value + 1); void chat.retry(requestId); },
    edit: editInto,
    cancel: (requestId) => void chat.discard(requestId),
  }), [waiting, workspace.online, chat, editInto]);

  const work = bot ? team.work?.bots[bot.id] : undefined;
  const approvalWaiting = team.work?.approvals.some((entry) => (bot ? entry.botId === bot.id : room ? entry.roomId === room.id : false));
  const activity: MobileAgentActivity | undefined = chat.running || work || approvalWaiting
    ? { agentId: conversation.id, turnId: null, phase: approvalWaiting ? "waiting" : "working", detail: work?.said ?? work?.note ?? work?.tool ?? null, ...(approvalWaiting ? { reason: "approval" as const } : {}) }
    : undefined;

  const keyboardOffset = Math.max(insets.bottom, 10) - 10;
  const lastUserId = [...messages].reverse().find((message) => message.kind === "message" && message.author === "user")?.id ?? null;
  const ready = chat.status === "connected" || messages.length > 0;
  const motion = useChatMotion(insets.top + 84, keyboardOffset, ready, messages.length > 0, lastUserId);
  const liquidGlassAvailable = isLiquidGlassAvailable() && !reducedTransparency;
  const canSend = chat.status !== "unauthorized";
  const sentRef = useRef(0);

  const send = useCallback((text: string) => {
    chat.setDraft(text);
    sentRef.current++;
    setReplyTarget(null);
    void chat.send();
  }, [chat]);

  return (
    <View className="flex-1" style={{ backgroundColor: background }}>
      <KeyboardGestureArea style={{ flex: 1 }} textInputNativeID="chat-composer-input" interpolator="ios" enableSwipeToDismiss>
        <ChatMessageList
          agents={agents}
          rowsShown
          target={target}
          motion={motion}
          sending={waiting.some((item) => item.state === "sending")}
          awaitingTurn={false}
          keyboardOffset={keyboardOffset}
          canSend={canSend}
          online={workspace.online}
          activity={activity}
          historyState={ready ? "ready" : chat.status === "connecting" ? "connecting" : "loading"}
          appActive={appActive}
          activeTurnId={null}
          fieldBackground={fieldBackground}
          foreground={foreground}
          messages={messages}
          messageAliases={NO_ALIASES}
          referenceMessages={NO_MESSAGES}
          hasOlder={chat.hasOlder}
          olderLoading={chat.loadingOlder}
          olderError={false}
          onLoadOlder={() => void chat.loadOlder()}
          onReply={setReplyTarget}
          muted={muted}
          raised={raised}
          showStarter={false}
          topInset={insets.top}
          onDismissStarter={() => undefined}
          onSelectStarter={send}
          onRetryHistory={() => void chat.loadOlder()}
          outboxStatuses={statuses}
        />
        <ChatComposer
          sendRetryVersion={sendRetryVersion}
          replyTarget={replyTarget}
          replyFocusVersion={0}
          onCancelReply={() => setReplyTarget(null)}
          mentionAgents={room ? agents.filter((entry) => room.members.includes(entry.id)) : []}
          action={action}
          actionForeground={actionForeground}
          agentName={conversation.name}
          bottomInset={insets.bottom}
          disabled={!canSend}
          draft={chat.draft}
          fallbackBackground={fieldBackground}
          foreground={foreground}
          liquidGlassAvailable={liquidGlassAvailable}
          muted={muted}
          raised={raised}
          onChangeDraft={chat.setDraft}
          onSend={send}
          onStop={chat.running ? () => void chat.stop() : undefined}
          keyboardProgress={motion.keyboardProgress}
        />
      </KeyboardGestureArea>
    </View>
  );
}
