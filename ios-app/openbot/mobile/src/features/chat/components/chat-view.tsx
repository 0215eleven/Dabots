import { tr } from '@ds/text';
// DS adaptation of OpenBot's ChatView composition. Full upstream transport version is preserved
// in openbot/adaptations/original. Message list, markdown, header, composer and motion are original.
import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { KeyboardGestureArea } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { Button, Typography } from 'heroui-native';
import { useThemeColor } from 'heroui-native/hooks';
import { ChatHeader } from './chat-header';
import { ChatMessageList } from './chat-message-list';
import { ChatComposer } from './chat-composer';
import { useChatMotion } from './use-chat-motion';
import type { ChatTarget } from '../model/chat-target';
import { useDs } from '@ds/provider';
import { GroupActivity } from '@ds/group-activity';
import { useDsChat } from '@ds/use-chat';
import { screenMessages } from '@ds/chat-binding';
import { mutationProblem, sendScreenMessage } from '@ds/screen-binding';
import { Unavailable } from '@ds/routes';
export function ChatView({ conversationId, ownerId }: {
    conversationId: string;
    ownerId: string;
}) {
    const state = useDsChat(conversationId);
    const { agents } = useDs();
    const bot = state.view?.bots.find(b => b.id === ownerId), group = state.view?.groups.find(g => g.id === ownerId);
    const agent = agents.find(a => a.id === ownerId);
    const target: ChatTarget | undefined = agent ? { ...agent, kind: 'agent' } : group ? { id: group.id, serverId: group.serverId, name: group.name, kind: 'channel', members: agents.filter(a => group.members.includes(a.id)) } : undefined;
    const insets = useSafeAreaInsets();
    const [foreground, muted, fieldBackground, raised, action, actionForeground, background] = useThemeColor(['foreground', 'muted', 'default', 'surface-tertiary', 'accent', 'accent-foreground', 'background']);
    const messages = useMemo(() => screenMessages(state.messages), [state.messages]);
    const motion = useChatMotion(insets.top + 44, Math.max(insets.bottom, 10) - 10, state.ready, messages.length > 0, messages.findLast(m => m.author === 'user')?.id ?? null);
    const [draft, setDraft] = useState('');
    const [sendRetryVersion, setRetry] = useState(0);
    const sending = useRef(false);
    const [busy, setBusy] = useState(false);
    const [stopping, setStopping] = useState(false);
    const uncertain = state.pending.some(p => p.persistence === 'unconfirmed');
    const canSend = Boolean(state.core && state.view?.capabilities.send && !state.view.readOnly && !uncertain);
    async function send(text: string) { if (!state.core || sending.current || !canSend)
        return; sending.current = true; setBusy(true); try {
        const result = await sendScreenMessage(state.core, conversationId, text);
        if (result.queued) {
            setDraft('');
            state.setError('');
        }
        else if (result.problem) {
            state.setError(tr(result.problem.message));
            setRetry(n => n + 1);
        }
    }
    catch (error) {
        state.setError(mutationProblem(error).message);
        setRetry(n => n + 1);
    }
    finally {
        sending.current = false;
        setBusy(false);
    } }
    async function pendingAction(id: string, action: 'retry' | 'discard') { try {
        if (action === 'retry')
            await state.core?.retrySend(id);
        else
            await state.core?.discardSend(id);
        state.setError('');
    }
    catch (error) {
        state.setError(mutationProblem(error).message);
    } }
    async function stop() { if (stopping)
        return; setStopping(true); try {
        await state.core?.cancel(conversationId);
    }
    catch (error) {
        state.setError(mutationProblem(error).message);
    }
    finally {
        setStopping(false);
    } }
    const work = state.view?.work[ownerId];
    if (!target)
        return <Unavailable />;
    return <View className="flex-1" style={{ backgroundColor: background }}><Stack.Screen options={{ headerShown: false }}/>
  <KeyboardGestureArea style={{ flex: 1 }} textInputNativeID="chat-composer-input" interpolator="ios">
   <ChatHeader target={target} needsAction={false} channelBrowser={null} fallbackBackground={fieldBackground} foreground={foreground} liquidGlassAvailable={false} topInset={insets.top} onBack={() => router.canGoBack() ? router.back() : router.replace('/')}/>
   <ChatMessageList target={target} rowsShown agents={agents} motion={motion} sending={busy} awaitingTurn={false} keyboardOffset={Math.max(insets.bottom, 10) - 10} canSend={canSend} online={state.online} appActive activeTurnId={null} activityAccessory={group ? <GroupActivity groupId={group.id}/> : undefined} activity={work && work.phase !== 'idle' ? { agentId: ownerId, phase: work.phase, detail: work.detail, turnId: null } : undefined} fieldBackground={fieldBackground} foreground={foreground} muted={muted} raised={raised} historyState={state.ready ? 'ready' : state.error ? 'error' : state.online ? 'loading' : 'waiting'} messages={messages} messageAliases={new Map()} referenceMessages={messages} hasOlder={Boolean(state.cursor)} olderLoading={state.olderLoading} olderError={false} onLoadOlder={() => void state.load(true)} showStarter={false} topInset={insets.top} onDismissStarter={() => { }} onSelectStarter={text => void send(text)} onRetryHistory={() => void state.load()}/>
   <Animated.View style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, motion.composerStyle]} onLayout={motion.onComposerLayout}>
    {state.error ? <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">{state.error}</Typography.Paragraph> : null}
    {state.pending.map(item => <View key={item.requestId} className="gap-1 px-4 py-2"><Typography.Paragraph selectable>{item.text}</Typography.Paragraph><Typography.Paragraph type="body-xs">{item.state === 'accepted' ? 'Accepted by computer · waiting for transcript' : item.state}{item.persistence ? ' · local storage unconfirmed' : ''}{item.error ? ` · ${item.error}` : ''}</Typography.Paragraph><View className="flex-row gap-2">{item.state === 'unconfirmed' ? <Button variant="secondary" onPress={() => void pendingAction(item.requestId, 'retry')}><Button.Label>{tr("Retry existing message")}</Button.Label></Button> : null}{item.state === 'unconfirmed' || item.state === 'rejected' ? <Button variant="ghost" onPress={() => void pendingAction(item.requestId, 'discard')}><Button.Label>{tr("Discard")}</Button.Label></Button> : null}</View></View>)}
    {canSend ? <ChatComposer key={conversationId} sendRetryVersion={sendRetryVersion} replyTarget={null} replyFocusVersion={0} onCancelReply={() => { }} mentionAgents={[]} action={action} actionForeground={actionForeground} agentName={target.name} bottomInset={insets.bottom} disabled={busy} draft={draft} fallbackBackground={fieldBackground} foreground={foreground} liquidGlassAvailable={false} muted={muted} raised={raised} onChangeDraft={setDraft} onSend={text => void send(text)} onStop={work && work.phase !== 'idle' && state.view?.capabilities.cancel ? () => void stop() : undefined} stopping={stopping} keyboardProgress={motion.keyboardProgress}/> : <Typography.Paragraph className="p-4">{state.view?.readOnly || 'Sending is unavailable. Resolve pending messages or check this computer’s capabilities.'}</Typography.Paragraph>}
   </Animated.View>
  </KeyboardGestureArea>
 </View>;
}
