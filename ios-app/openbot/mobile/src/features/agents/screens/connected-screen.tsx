import { useReducedMotion } from '@/shared/lib/motion';
import { useDsText } from '@ds/text';
import type { ChannelSummary } from '@openbot/contracts/ipc';
import { router, Stack } from 'expo-router';
import { Typography } from 'heroui-native';
import { memo, useMemo, useState, useLayoutEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import PlusIcon from 'lucide-react-native/icons/plus';
import { type MenuAction, MenuView } from '@/shared/components/menu-view';
import EllipsisIcon from 'lucide-react-native/icons/ellipsis';
import LaptopIcon from 'lucide-react-native/icons/laptop';
import ListIcon from 'lucide-react-native/icons/layout-list';
import ArmchairIcon from 'lucide-react-native/icons/armchair';
import { OfficeView } from '@/features/agents/components/office-view';
import { GlassSwitch } from '@/features/agents/components/glass-switch';
import { useHomeView, type HomeView } from '@ds/home-view';
import { ChatGlassButton } from '@/features/chat/components/chat-glass-icon-button';
import { useLiquidGlass } from '@/shared/lib/use-liquid-glass';
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
import { peerBotColor, peerRows, useComputerNames, useComputers, usePeerHosts, type PeerRow } from '@ds/computers';
import { PeerChatRow } from '@/features/agents/components/peer-chat-row';
import { useUniwind } from 'uniwind';
import { ComputerTagContext } from '@/features/workspace/components/computer-tag';
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
// DS Bot Mobile layout: compact icon actions with a connection dot, an optional
// pinned section and a hairline-separated list. The list rows and motion stay OpenBot's.
const ROW_LEFT = 16;
const ROW_AVATAR = 48;
function RowSeparator() {
    return <View className="bg-separator" style={{ height: StyleSheet.hairlineWidth, marginLeft: ROW_LEFT + ROW_AVATAR + 12, marginRight: 0 }}/>;
}
function IconButton({ label, status, onPress, disabled, children }: { label: string; status?: string; onPress?: () => void; disabled?: boolean; children: React.ReactNode }) {
    const fallback = useThemeColor('default');
    const liquidGlass = useLiquidGlass();
    return <ChatGlassButton accessibilityLabel={label} accessibilityValue={status ? {text: status} : undefined} disabled={disabled} onPress={onPress} fallbackBackground={fallback} liquidGlassAvailable={liquidGlass} width={44} height={44}>{children}</ChatGlassButton>;
}
function SectionLabel({ children }: { children: string }) {
    return <Typography.Paragraph className="text-muted" style={{ fontSize: 13, lineHeight: 18, fontWeight: '600', paddingHorizontal: ROW_LEFT + 4, paddingTop: 8, paddingBottom: 2 }}>{children}</Typography.Paragraph>;
}
// DS Bot Mobile: one chip per paired computer, however it was added. "All" lists every computer's
// chats with a computer tag on each row; a computer chip shows that computer alone.
function ComputerChip({ label, selected, status, disabled, onPress }: { label: string; selected: boolean; status?: 'online' | 'offline'; disabled?: boolean; onPress: () => void }) {
    const [foreground, muted, success] = useThemeColor(['foreground', 'muted', 'success']);
    const color = selected ? String(foreground) : String(muted);
    return <Pressable accessibilityRole="tab" accessibilityState={{ selected, disabled }} accessibilityLabel={label} disabled={disabled} onPress={onPress} className={`flex-row items-center gap-1.5 rounded-full px-3.5 ${selected ? 'bg-control' : ''}`} style={({ pressed }) => ({ height: 34, opacity: disabled ? 0.5 : pressed ? 0.6 : 1 })}>
     {status ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status === 'online' ? String(success) : String(muted), opacity: status === 'online' ? 1 : 0.6 }}/> : null}
     {status ? <LaptopIcon size={15} color={color} strokeWidth={2}/> : null}
     <Typography.Paragraph numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color }}>{label}</Typography.Paragraph>
    </Pressable>;
}
// DS Bot Mobile: the quick switch between the chat list and the office, between the bottom actions.
function ViewSwitch({ value, onChange }: { value: HomeView; onChange: (value: HomeView) => void }) {
    const { tr } = useDsText();
    return <GlassSwitch value={value} onChange={onChange} options={[{ id: 'list', label: tr('Chats'), Icon: ListIcon }, { id: 'office', label: tr('Office'), Icon: ArmchairIcon }]}/>;
}
/** Original OpenBot list composition, bound to the selected DS computer. */
export function ConnectedScreen() {
    const { view, online, times } = useDs();
    const { tr } = useDsText();
    const [foreground, muted] = useThemeColor(['foreground', 'muted']);
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
    const create = (id: string) => { if (!computers.switching) router.push(id === 'group' ? '/add-channel' : '/add-agent'); };
    const plus = <PlusIcon size={20} color={foreground} strokeWidth={2}/>;
    const hasPinned = pinnedAgents.length > 0 || pinnedGroups.length > 0;
    const computers = useComputers();
    const names = useComputerNames();
    const [allComputers, setAllComputers] = useState(true);
    // A single-computer label always belongs to the workspace being displayed,
    // including while another selection is waiting on credentials or SQLite.
    const filter = allComputers ? 'all' : computers.host?.serverId ?? 'all';
    const multiple = computers.hosts.length > 1;
    const tags = useMemo(() => multiple && filter === 'all' ? new Map(computers.hosts.map(h => [h.serverId, names.name(h)])) : null, [multiple, filter, computers.hosts, names]);
    const pick = (serverId: string) => {
        if (computers.switching) return;
        const host = computers.hosts.find(h => h.serverId === serverId);
        if (!host) return;
        if (host.serverId === computers.host?.serverId) setAllComputers(false);
        else void computers.switchHost(host).then(ok => { if (ok) setAllComputers(false); });
    };
    // "All" merges the other computers' chats, newest first, with the active computer's unpinned chats.
    const { peers } = usePeerHosts();
    const dark = useUniwind().theme === 'dark';
    const peerItems = useMemo(() => !multiple || filter !== 'all' ? [] : Object.values(peers).flatMap(peer => peerRows(peer, peerBotColor(dark)).map(row => ({ id: row.id, peer: row, at: row.at }))), [multiple, filter, peers, dark]);
    const listed: Array<{ id: string; agent?: MobileAgent; channel?: ChannelSummary; peer?: PeerRow }> = peerItems.length
        ? [...items.map(item => ({ ...item, at: times[item.id] ?? 0 })), ...peerItems].sort((a, b) => b.at - a.at)
        : items;
    const status = (serverId: string): 'online' | 'offline' => serverId === computers.host?.serverId ? (online ? 'online' : 'offline') : peers[serverId]?.online ? 'online' : 'offline';
    const openPeer = async (row: PeerRow) => {
        if (computers.switching) return;
        const host = computers.hosts.find(h => h.serverId === row.serverId);
        if (!host || !(await computers.switchHost(host))) return;
        router.push(row.kind === 'group' ? { pathname: '/channel/[channelId]', params: { channelId: row.id, serverId: row.serverId } } : { pathname: '/chat/[agentId]', params: { agentId: row.id } });
    };
    const [homeView, setHomeView] = useHomeView();
    const chips = multiple ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: ROW_LEFT, paddingTop: 4, paddingBottom: 4 }}>
     <ComputerChip label={tr('All')} selected={filter === 'all'} disabled={computers.switching} onPress={() => { if (!computers.switching) setAllComputers(true); }}/>
     {computers.hosts.map(h => <ComputerChip key={h.slot || h.serverId} label={names.name(h)} selected={filter === h.serverId} status={status(h.serverId)} disabled={computers.switching} onPress={() => pick(h.serverId)}/>)}
     {computers.switching ? <ActivityIndicator accessibilityLabel={tr('Connecting…')} size="small" color={String(muted)} /> : null}
    </ScrollView> : null;
    return <ComputerTagContext.Provider value={tags}><View className="flex-1 bg-background">
  <Stack.Screen options={{ headerShown: false }}/>
  {/* The list pads both safe-area edges itself; UIKit must not add them again. Settings and New float at the bottom corners. */}
  {homeView === 'office' ? <OfficeView agents={shownAgents} rooms={shownGroups} work={view?.work ?? {}} header={chips} topInset={insets.top + 6} bottomInset={insets.bottom + 24 + 60} sideInsets={{ left: insets.left, right: insets.right }}
    onOpenBot={agent => router.push({ pathname: '/chat/[agentId]', params: { agentId: agent.id } })} onOpenRoom={room => router.push({ pathname: '/channel/[channelId]', params: { channelId: room.id, serverId: activeServer.id } })}/>
  : <Animated.FlatList data={listed} key={activeServer.id} keyExtractor={item => item.id} onScroll={scroll.onScroll} onLayout={listReveal.onLayout} itemLayoutAnimation={LinearTransition.duration(240).reduceMotion(reducedMotion ? ReduceMotion.Always : ReduceMotion.System)} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 24 + 60, paddingLeft: insets.left, paddingRight: insets.right }} ItemSeparatorComponent={RowSeparator} renderItem={({ item, index }) => item.peer ? <PeerChatRow row={item.peer} online={peers[item.peer.serverId]?.online === true} onOpen={row => void openPeer(row)}/> : <TransitioningChatRow agent={item.agent} channel={item.channel} serverId={activeServer.id} channelAgents={channelAgents} index={index} reveal={listReveal} collapsed={false}/>} ListHeaderComponent={<>
   {chips}
   {computers.error ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text px-4 py-2">{tr(computers.error)}</Typography.Paragraph> : null}
   {view?.readOnly ? <View className="mx-4 mb-3 rounded-2xl bg-control px-4 py-3"><Typography.Paragraph className="text-text-secondary" style={{ fontSize: 13, lineHeight: 18 }}>{tr(view.readOnly)}</Typography.Paragraph></View> : null}
   {hasPinned ? <>
    <SectionLabel>{tr('Pinned chats')}</SectionLabel>
    <PinnedAgentsGrid agents={pinnedAgents}>{pinnedGroups.map(channel => <ChannelListRow key={channel.id} channel={channel} serverId={activeServer.id} agents={channelAgents} pinned/>)}</PinnedAgentsGrid>
    <View className="bg-separator" style={{ height: StyleSheet.hairlineWidth, marginLeft: ROW_LEFT + 4 }}/>
   </> : null}
  </>} ListFooterComponent={hiddenCount > 0 || showHidden ? <Pressable accessibilityRole="button" onPress={() => setShowHidden(!showHidden)} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'center', marginTop: 18, paddingHorizontal: 14, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
    <Typography.Paragraph className="text-muted" style={{ fontSize: 13, lineHeight: 18 }}>{tr(showHidden ? 'Hide hidden chats' : 'Show hidden chats')}</Typography.Paragraph>
   </Pressable> : undefined} ListEmptyComponent={<View className="items-center px-8 pt-16"><Typography.Paragraph className="text-muted" align="center">{tr(view ? 'No chats to show.' : 'Reading this computer…')}</Typography.Paragraph></View>}/>}
  <View pointerEvents="box-none" className="absolute flex-row items-center gap-2" style={{ left: ROW_LEFT + insets.left, right: ROW_LEFT + insets.right, bottom: Math.max(insets.bottom, 12) + 4 }}>
   <IconButton label={tr('Settings')} status={tr(online ? 'Connected' : 'Disconnected')} onPress={() => router.push('/settings')}>
    <EllipsisIcon size={22} color={foreground} strokeWidth={2} accessible={false}/>
   </IconButton>
   <View pointerEvents="none" className="flex-1" />
   <ViewSwitch value={homeView} onChange={setHomeView}/>
   <View pointerEvents="none" className="flex-1" />
   {createActions.length > 1 ? computers.switching ? <IconButton label={tr('New chat')} disabled>{plus}</IconButton> : <MenuView actions={createActions} onPressAction={({ nativeEvent }) => create(nativeEvent.event)}><IconButton label={tr('New chat')}>{plus}</IconButton></MenuView>
       : createActions.length === 1 ? <IconButton label={createActions[0].title} disabled={computers.switching} onPress={() => create(createActions[0].id ?? 'bot')}>{plus}</IconButton> : <View style={{ width: 44 }}/>}
  </View>
 </View></ComputerTagContext.Provider>;
}
