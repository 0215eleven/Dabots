import { useReducedMotion } from '@/shared/lib/motion';
import { useDsText } from '@ds/text';
import type { ChannelSummary } from '@openbot/contracts/ipc';
import { router, Stack } from 'expo-router';
import { Button, Typography } from 'heroui-native';
import { memo, useMemo, useState, useLayoutEffect } from 'react';
import { Pressable, View } from 'react-native';
import SettingsIcon from 'lucide-react-native/icons/settings';
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
import { LargeTitle, useLargeTitleScroll } from '@/shared/components/large-title';
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
              {agent ? (<AgentListRow agent={agent} leftInset={15} rightInset={24}/>) : channel && serverId && channelAgents ? (<ChannelListRow channel={channel} serverId={serverId} agents={channelAgents} leftInset={15} rightInset={24}/>) : null}
            </AgentListRowReveal>
          </Animated.View>
        </Animated.View>) : null}
    </Animated.View>);
});
function listItemKey(item: MobileSidebarItem) {
    return `${item.kind}:${item.id}`;
}
/** Original OpenBot list composition, bound to the selected DS computer. */
export function ConnectedScreen() {
    const { view, core, online } = useDs();
    const { tr } = useDsText();
    const foreground = useThemeColor('foreground');
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
    const items = [...shownAgents.filter(a => !pinnedAgentIds.includes(a.id)).map(agent => ({ id: agent.id, agent })), ...shownGroups.filter(c => !pinnedChannelIds.includes(c.id)).map(channel => ({ id: channel.id, channel }))];
    return <View className="flex-1 bg-background">
  <Stack.Screen options={{ headerShown: false }}/>
  <Animated.FlatList data={items} key={activeServer.id} keyExtractor={item => item.id} onScroll={scroll.onScroll} onLayout={listReveal.onLayout} itemLayoutAnimation={LinearTransition.duration(240).reduceMotion(reducedMotion ? ReduceMotion.Always : ReduceMotion.System)} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }} renderItem={({ item, index }) => <TransitioningChatRow {...item} serverId={activeServer.id} channelAgents={channelAgents} index={index} reveal={listReveal} collapsed={false}/>} ListHeaderComponent={<>
   <View className="flex-row items-center"><View className="flex-1"><LargeTitle scroll={scroll} title="DeepSeek Bot Pro"/></View><Pressable accessibilityRole="button" accessibilityLabel={tr("Settings")} onPress={() => router.push('/settings')} style={{width:44,height:44,alignItems:'center',justifyContent:'center',marginRight:16}}><SettingsIcon size={24} color={foreground}/></Pressable></View>
   <View className="gap-3 px-5 pb-5">
    <Typography.Paragraph>{tr(online ? 'Connected' : 'Offline · saved desktop state')}</Typography.Paragraph>
    {view?.readOnly ? <Typography.Paragraph>{tr(view.readOnly)}</Typography.Paragraph> : null}
    <View className="flex-row flex-wrap gap-2">
     {view?.capabilities.actions.includes('create-bot') ? <Button onPress={() => router.push('/add-agent')}><Button.Label>{tr("Add Bot")}</Button.Label></Button> : null}
     {view?.capabilities.actions.includes('create-room') ? <Button variant="secondary" onPress={() => router.push('/add-channel')}><Button.Label>{tr("New group")}</Button.Label></Button> : null}
     <Button variant="ghost" onPress={() => setShowHidden(!showHidden)}><Button.Label>{tr(showHidden ? 'Hide hidden chats' : 'Show hidden chats')}</Button.Label></Button>
    </View>
   </View>
   <PinnedAgentsGrid agents={pinnedAgents}>{shownGroups.filter(c => pinnedChannelIds.includes(c.id)).map(channel => <ChannelListRow key={channel.id} channel={channel} serverId={activeServer.id} agents={channelAgents} pinned/>)}</PinnedAgentsGrid>
  </>} ListEmptyComponent={<View className="p-5"><Typography.Paragraph>{tr(view ? 'No chats to show.' : 'Reading this computer…')}</Typography.Paragraph></View>}/>
 </View>;
}
