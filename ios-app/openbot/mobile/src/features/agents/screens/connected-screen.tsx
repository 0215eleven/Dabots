import { useReducedMotion } from '@/shared/lib/motion';
import { useDsText } from '@ds/text';
import type { ChannelSummary } from '@openbot/contracts/ipc';
import { router, Stack } from 'expo-router';
import { Typography } from 'heroui-native';
import { memo, useMemo, useState, useLayoutEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import PlusIcon from 'lucide-react-native/icons/plus';
import { type MenuAction, MenuView } from '@/shared/components/menu-view';
import { BotAvatar, mainLook } from '../../../../../../src/components/BotAvatar';
import { useThemeColor } from 'heroui-native/hooks';
import Animated, { cancelAnimation, Easing, FadeIn, LinearTransition, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgentListRowReveal, useAgentListReveal, type AgentListRevealState } from '@/features/agents/components/agent-list-reveal';
import { AgentListRow } from '@/features/agents/components/agent-list-row';
import { useAgentPinTransition } from '@/features/agents/components/agent-pin-transition';
import { PinnedAgentsGrid } from '@/features/agents/components/pinned-agents-grid';
import { ChannelListRow } from '@/features/channels/components/channel-list';
import { useChannels } from '@/features/channels/components/use-channels';
import { useMobileWorkspace, type MobileAgent } from '@/features/workspace/context/mobile-workspace-context';
import type { MobileSidebarItem } from '@/features/workspace/model/sidebar-layout';
import { useLargeTitleScroll } from '@/shared/components/large-title';
import { useDs } from '@ds/provider';
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);


/** A chat row: an agent, or a channel with its server and the agents of that server. */
interface ChatRowTarget {
    agent?: MobileAgent;
    channel?: ChannelSummary;
    serverId?: string;
    channelAgents?: ReadonlyMap<string, MobileAgent>;
}
const TransitioningChatRow = memo(function TransitioningChatRow({ agent, channel, serverId, channelAgents, index, reveal, collapsed, }: ChatRowTarget & {
    index: number;
    reveal: AgentListRevealState;
    collapsed: boolean;
}) {
    const { transition } = useAgentPinTransition();
    const reducedMotion = useReducedMotion();
    const chatId = agent?.id ?? channel?.id;
    const isTarget = transition !== null && transition.chatId === chatId && transition.target === "row";
    const [initiallyExpanded] = useState(!collapsed);
    const [contentMounted, setContentMounted] = useState(!collapsed);
    const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
    // An expanded row at rest lays out in the flow with no animated height. A later render then
    // cannot put back a first-render height of 0 when the animated value has not reached React.
    const [settled, setSettled] = useState(!collapsed);
    const height = useSharedValue(0);
    useLayoutEffect(() => {
        if (!collapsed)
            setContentMounted(true);
        else
            setSettled(false);
        if (measuredHeight === null)
            return;
        let active = true;
        const releaseContent = () => {
            if (active)
                setContentMounted(false);
        };
        const settle = () => {
            if (active)
                setSettled(true);
        };
        height.set(withTiming(collapsed ? 0 : measuredHeight, {
            duration: 240,
            easing: EASE_OUT,
            reduceMotion: reducedMotion ? ReduceMotion.Always : ReduceMotion.System,
        }, (finished) => {
            if (!finished)
                return;
            scheduleOnRN(collapsed ? releaseContent : settle);
        }));
        return () => {
            active = false;
            cancelAnimation(height);
        };
    }, [collapsed, height, measuredHeight, reducedMotion]);
    const bodyStyle = useAnimatedStyle(() => ({
        height: measuredHeight === null && initiallyExpanded ? undefined : height.get(),
        overflow: "hidden",
    }));
    // Derive the fade from the same height, so a reversed toggle cannot leave
    // opacity and the accordion at different points in their transitions.
    const contentStyle = useAnimatedStyle(() => ({
        opacity: measuredHeight !== null && measuredHeight > 0
            ? Math.min(1, Math.max(0, height.get() / measuredHeight))
            : initiallyExpanded
                ? 1
                : 0,
    }));
    const resting = !collapsed && (settled || (measuredHeight === null && initiallyExpanded));
    return (<Animated.View style={resting ? undefined : bodyStyle} pointerEvents={collapsed ? "none" : "auto"} accessibilityElementsHidden={collapsed} importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}>
      {contentMounted ? (<Animated.View style={resting ? undefined : [{ position: "absolute", top: 0, left: 0, right: 0 }, contentStyle]} onLayout={({ nativeEvent }) => {
                const nextHeight = nativeEvent.layout.height;
                // At rest the row takes its own height, so a collapse starts from the height it has now.
                if (resting)
                    height.set(nextHeight);
                setMeasuredHeight(nextHeight);
            }}>
          <Animated.View collapsable={false} entering={isTarget ? FadeIn.duration(180).reduceMotion(reducedMotion ? ReduceMotion.Always : ReduceMotion.System) : undefined}>
            <AgentListRowReveal index={index} reveal={reveal} skip={isTarget}>
              {agent ? (<AgentListRow agent={agent} leftInset={16} rightInset={16}/>) : channel && serverId && channelAgents ? (<ChannelListRow channel={channel} serverId={serverId} agents={channelAgents} leftInset={16} rightInset={16}/>) : null}
            </AgentListRowReveal>
          </Animated.View>
        </Animated.View>) : null}
    </Animated.View>);
});
function listItemKey(item: MobileSidebarItem) {
    return `${item.kind}:${item.id}`;
}
/** Original OpenBot list composition, bound to the selected DS computer. */
// DS Bot Mobile layout: a compact brand bar with icon actions, a quiet connection line, an optional
// pinned section and a hairline-separated list. The list rows and motion stay OpenBot's.
const ROW_LEFT = 16;
const ROW_AVATAR = 48;
function RowSeparator() {
    return <View className="bg-separator" style={{ height: StyleSheet.hairlineWidth, marginLeft: ROW_LEFT + ROW_AVATAR + 12, marginRight: 0 }}/>;
}
function IconButton({ label, onPress, children }: { label: string; onPress?: () => void; children: React.ReactNode }) {
    // Ordinary navigation-sized circles, with real 44-point targets on both platforms.
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className="items-center justify-center rounded-full bg-control" style={({ pressed }) => ({ width: 44, height: 44, opacity: pressed ? 0.6 : 1 })}>{children}</Pressable>;
}
function SectionLabel({ children }: { children: string }) {
    return <Typography.Paragraph className="text-muted" style={{ fontSize: 13, lineHeight: 18, fontWeight: '600', paddingHorizontal: ROW_LEFT + 4, paddingTop: 8, paddingBottom: 2 }}>{children}</Typography.Paragraph>;
}
/** Original OpenBot list composition, bound to the selected DS computer. */
export function ConnectedScreen() {
    const { view, online } = useDs();
    const { tr } = useDsText();
    const [foreground, success, muted] = useThemeColor(['foreground', 'success', 'muted']);
    const reducedMotion = useReducedMotion();
    const { activeAgents, activeServer, agents, pinnedAgentIds, pinnedChannelIds, hiddenChannelIds } = useMobileWorkspace();
    const channels = useChannels(activeServer.id);
    const insets = useSafeAreaInsets();
    const scroll = useLargeTitleScroll();
    const listReveal = useAgentListReveal(true, activeServer.id);
    const channelAgents = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents]);
    const [showHidden, setShowHidden] = useState(false);
    const shownAgents = showHidden ? agents : activeAgents;
    const pinnedAgents = shownAgents.filter(a => pinnedAgentIds.includes(a.id));
    const shownGroups = channels.channels.filter(c => showHidden || !hiddenChannelIds.includes(c.id));
    const pinnedGroups = shownGroups.filter(c => pinnedChannelIds.includes(c.id));
    const items = [...shownAgents.filter(a => !pinnedAgentIds.includes(a.id)).map(agent => ({ id: agent.id, agent })), ...shownGroups.filter(c => !pinnedChannelIds.includes(c.id)).map(channel => ({ id: channel.id, channel }))];
    const hiddenCount = agents.length - activeAgents.length + channels.channels.filter(c => hiddenChannelIds.includes(c.id)).length;
    const canAddBot = view?.capabilities.actions.includes('create-bot') ?? false;
    const canAddGroup = view?.capabilities.actions.includes('create-room') ?? false;
    const createActions: MenuAction[] = [...(canAddBot ? [{ id: 'bot', title: tr('Add Bot'), image: 'person.badge.plus' as const }] : []), ...(canAddGroup ? [{ id: 'group', title: tr('New group'), image: 'person.2' as const }] : [])];
    const create = (id: string) => router.push(id === 'group' ? '/add-channel' : '/add-agent');
    const plus = <PlusIcon size={20} color={foreground} strokeWidth={2}/>;
    const hasPinned = pinnedAgents.length > 0 || pinnedGroups.length > 0;
    return <View className="flex-1 bg-background">
  <Stack.Screen options={{ headerShown: false }}/>
  {/* This custom header already pads both safe-area edges; UIKit must not add them again. */}
  <Animated.FlatList data={items} key={activeServer.id} keyExtractor={item => item.id} onScroll={scroll.onScroll} onLayout={listReveal.onLayout} itemLayoutAnimation={LinearTransition.duration(240).reduceMotion(reducedMotion ? ReduceMotion.Always : ReduceMotion.System)} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 24, paddingLeft: insets.left, paddingRight: insets.right }} ItemSeparatorComponent={RowSeparator} renderItem={({ item, index }) => <TransitioningChatRow {...item} serverId={activeServer.id} channelAgents={channelAgents} index={index} reveal={listReveal} collapsed={false}/>} ListHeaderComponent={<>
   <View className="flex-row items-center gap-2" style={{ paddingHorizontal: ROW_LEFT, paddingTop: 6, paddingBottom: 2 }}>
    <IconButton label={tr('Settings')} onPress={() => router.push('/settings')}><View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><BotAvatar bot={mainLook} size={28}/></View></IconButton>
    <Typography.Heading accessibilityRole="header" numberOfLines={1} className="flex-1 font-bold" style={{ fontSize: 22, lineHeight: 28, letterSpacing: -0.3 }}>MyBot</Typography.Heading>
    {createActions.length > 1 ? <MenuView actions={createActions} onPressAction={({ nativeEvent }) => create(nativeEvent.event)}><IconButton label={tr('New chat')}>{plus}</IconButton></MenuView>
        : createActions.length === 1 ? <IconButton label={createActions[0].title} onPress={() => create(createActions[0].id ?? 'bot')}>{plus}</IconButton> : null}
   </View>
   <View className="flex-row items-center gap-1.5" style={{ paddingHorizontal: ROW_LEFT + 4, paddingBottom: 10 }}>
    <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: online ? String(success) : String(muted) }}/>
    <Typography.Paragraph className="text-muted" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>{[activeServer.name, tr(online ? 'Connected' : 'Offline · saved desktop state')].filter(Boolean).join(' · ')}</Typography.Paragraph>
   </View>
   {view?.readOnly ? <View className="mx-4 mb-3 rounded-2xl bg-control px-4 py-3"><Typography.Paragraph className="text-text-secondary" style={{ fontSize: 13, lineHeight: 18 }}>{tr(view.readOnly)}</Typography.Paragraph></View> : null}
   {hasPinned ? <>
    <SectionLabel>{tr('Pinned chats')}</SectionLabel>
    <PinnedAgentsGrid agents={pinnedAgents}>{pinnedGroups.map(channel => <ChannelListRow key={channel.id} channel={channel} serverId={activeServer.id} agents={channelAgents} pinned/>)}</PinnedAgentsGrid>
    <View className="bg-separator" style={{ height: StyleSheet.hairlineWidth, marginLeft: ROW_LEFT + 4 }}/>
   </> : null}
  </>} ListFooterComponent={hiddenCount > 0 || showHidden ? <Pressable accessibilityRole="button" onPress={() => setShowHidden(!showHidden)} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'center', marginTop: 18, paddingHorizontal: 14, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
    <Typography.Paragraph className="text-muted" style={{ fontSize: 13, lineHeight: 18 }}>{tr(showHidden ? 'Hide hidden chats' : 'Show hidden chats')}</Typography.Paragraph>
   </Pressable> : undefined} ListEmptyComponent={<View className="items-center px-8 pt-16"><Typography.Paragraph className="text-muted" align="center">{tr(view ? 'No chats to show.' : 'Reading this computer…')}</Typography.Paragraph></View>}/>
 </View>;
}
